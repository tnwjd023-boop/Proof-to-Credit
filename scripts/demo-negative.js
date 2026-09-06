'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Contract, FetchRequest, JsonRpcProvider } = require('ethers');
const { networkConfig } = require('../src/config');
const { verifierArgs } = require('../src/proof-client');
const { classifyNegativeEvidence } = require('../src/negative-result');
const { buildTamperedProofs, contractErrorName, evidenceClock } = require('../src/runtime-negative');

const MERKLE = '(bytes32 root,(bytes32 hash,bool isLeft)[] siblings)';
const CONTINUITY = '(bytes32 lowerEndpointDigest,bytes32[] roots)';
const VERIFIER_ABI = [
  `function verify(uint64,uint64,bytes,${MERKLE},${CONTINUITY}) view returns (bool)`,
  `function verifyAndEmit(uint64,uint64,bytes,${MERKLE},${CONTINUITY}) returns (bool)`,
  `function calculateTxIndex(${MERKLE}) view returns (uint64)`,
];

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function provider(url) {
  const request = new FetchRequest(url);
  request.timeout = 15_000;
  return new JsonRpcProvider(request);
}

function safeError(error) {
  return String(error.shortMessage || error.reason || error.message || error).slice(0, 500);
}

async function callVerifier(prover, args, blockTag) {
  try {
    return { method: 'verify.eth_call', verdict: Boolean(await prover.verify(...args, { blockTag })) };
  } catch (verifyError) {
    try {
      return {
        method: 'verifyAndEmit.eth_call',
        verdict: Boolean(await prover.verifyAndEmit.staticCall(...args, { blockTag })),
        verifyFallbackReason: safeError(verifyError),
      };
    } catch (fallbackError) {
      return {
        method: 'verifyAndEmit.eth_call',
        verdict: false,
        verifyFallbackReason: safeError(verifyError),
        rejection: safeError(fallbackError),
      };
    }
  }
}

async function main() {
  const clock = evidenceClock();
  const id = option('--run');
  const slot = option('--slot') || 'destinationT12';
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || !/^destination[A-Za-z0-9]*$/.test(slot)) {
    throw new Error('Usage: node scripts/demo-negative.js --run <runId> [--slot destinationT12]');
  }

  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'runs', id, 'manifest.json'), 'utf8'));
  const destination = manifest[slot];
  if (!destination?.gate?.address || !destination?.submissions?.['debt-opened'] || !destination?.submissions?.['debt-repaid']) {
    throw new Error('Selected destination lacks the canonical proof submissions');
  }
  const artifact = JSON.parse(await fs.readFile(path.join(root, 'artifacts', 'contracts.json'), 'utf8')).contracts.VerifiedDebtGate;
  const source = provider(networkConfig.source.rpcUrl);
  const cc3 = provider(networkConfig.destination.rpcUrl);
  const prover = new Contract(networkConfig.destination.blockProver, VERIFIER_ABI, cc3);
  const gate = new Contract(destination.gate.address, artifact.abi, cc3);

  try {
    const [sourceNetwork, destinationNetwork, observedBlock] = await Promise.all([
      source.getNetwork(),
      cc3.getNetwork(),
      cc3.getBlockNumber(),
    ]);
    if (sourceNetwork.chainId !== 11155111n || destinationNetwork.chainId !== 102031n) {
      throw new Error('Refusing unexpected source or destination network');
    }

    const stateBeforeHash = await gate.stateHash({ blockTag: observedBlock });
    const proofs = [];
    let openingBundle;
    for (const kind of ['debt-opened', 'debt-repaid']) {
      const saved = JSON.parse(await fs.readFile(path.join(root, 'runs', id, 'proofs', `${kind}.json`), 'utf8'));
      const bundle = saved.bundle;
      const sourceReceipt = await source.getTransactionReceipt(saved.sourceTransactionHash);
      if (
        saved.classification !== 'VERIFIED' ||
        !sourceReceipt ||
        sourceReceipt.status !== 1 ||
        BigInt(sourceReceipt.blockNumber) !== BigInt(bundle.headerNumber) ||
        BigInt(sourceReceipt.index) !== BigInt(bundle.txIndex)
      ) throw new Error(`${kind} source receipt and saved proof position do not match`);

      const args = verifierArgs(bundle);
      const { rootTampered, bytesTampered, continuityTampered } = buildTamperedProofs(bundle);
      const [derivedIndex, normal, badRoot, badBytes, badContinuity] = await Promise.all([
        prover.calculateTxIndex(args[3], { blockTag: observedBlock }),
        callVerifier(prover, args, observedBlock),
        callVerifier(prover, verifierArgs(rootTampered), observedBlock),
        callVerifier(prover, verifierArgs(bytesTampered), observedBlock),
        callVerifier(prover, verifierArgs(continuityTampered), observedBlock),
      ]);
      proofs.push({
        kind,
        sourceTransactionHash: saved.sourceTransactionHash,
        chainKey: String(bundle.chainKey),
        headerNumber: String(bundle.headerNumber),
        sourceBlockNumber: String(sourceReceipt.blockNumber),
        txIndex: String(bundle.txIndex),
        derivedIndex: derivedIndex.toString(),
        normal,
        rootTampered: badRoot,
        bytesTampered: badBytes,
        continuityTampered: badContinuity,
      });
      if (kind === 'debt-opened') openingBundle = bundle;
    }

    let replay;
    try {
      await gate.submitSourceTransaction.staticCall(...verifierArgs(openingBundle), { blockTag: observedBlock });
      replay = { rejected: false, errorName: null };
    } catch (error) {
      replay = {
        rejected: true,
        errorName: contractErrorName(error, gate.interface),
        rejection: safeError(error),
      };
    }
    const stateAfterHash = await gate.stateHash();
    const completedBlock = await cc3.getBlockNumber();
    const evidence = {
      classification: 'BLOCKED',
      callMode: 'eth_call',
      startedAt: clock.startedAt,
      completedAt: null,
      sourceChainId: sourceNetwork.chainId.toString(),
      destinationChainId: destinationNetwork.chainId.toString(),
      observedDestinationBlock: observedBlock,
      completedDestinationBlock: completedBlock,
      blockProver: networkConfig.destination.blockProver,
      applicationGate: destination.gate.address,
      proofs,
      replay,
      stateBeforeHash,
      stateAfterHash,
      note: 'All checks are read-only eth_call observations. Rejections are not failed transaction receipts or persistent logs.',
    };
    evidence.completedAt = clock.completedAt();
    evidence.classification = classifyNegativeEvidence(evidence);
    const outputPath = path.join(root, 'runs', id, 'negative.json');
    await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${outputPath}`);
    if (evidence.classification !== 'VERIFIED') process.exitCode = 1;
  } finally {
    source.destroy();
    cc3.destroy();
  }
}

main().catch((error) => {
  console.error(`T14_BLOCKED: ${safeError(error)}`);
  process.exitCode = 1;
});
