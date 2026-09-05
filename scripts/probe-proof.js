'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Contract, FetchRequest, JsonRpcProvider } = require('ethers');
const { networkConfig, assertTestnetOnly } = require('../src/config');
const { assertHealthyProofApi } = require('../src/health');
const { classifyProbe } = require('../src/probe-result');

const MERKLE = '(bytes32 root,(bytes32 hash,bool isLeft)[] siblings)';
const CONTINUITY = '(bytes32 lowerEndpointDigest,bytes32[] roots)';
const ABI = [
  `function verify(uint64,uint64,bytes,${MERKLE},${CONTINUITY}) view returns (bool)`,
  `function verifyAndEmit(uint64,uint64,bytes,${MERKLE},${CONTINUITY}) returns (bool)`,
  `function calculateTxIndex(${MERKLE}) view returns (uint64)`,
];

const getArg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

function rpcProvider(url) {
  const request = new FetchRequest(url);
  request.timeout = 15000;
  return new JsonRpcProvider(request);
}

async function findSampleTransaction(provider, startHeight) {
  for (let height = startHeight; height > startHeight - 100; height -= 1) {
    const block = await provider.getBlock(height);
    if (block?.transactions?.length) return { txHash: block.transactions[0], height };
  }
  throw new Error(`No Sepolia transaction found in blocks ${startHeight - 99}-${startHeight}`);
}

function verifierArgs(proof) {
  return [
    BigInt(proof.chainKey),
    BigInt(proof.headerNumber),
    proof.txBytes,
    [proof.merkleProof.root, proof.merkleProof.siblings.map((node) => [node.hash, node.isLeft])],
    [proof.continuityProof.lowerEndpointDigest, proof.continuityProof.roots],
  ];
}

function safeError(error) {
  return String(error.shortMessage || error.reason || error.message || error).slice(0, 500);
}

async function callVerifier(prover, args) {
  try {
    return { method: 'verify', verdict: Boolean(await prover.verify(...args)) };
  } catch (verifyError) {
    try {
      return {
        method: 'verifyAndEmit.eth_call',
        verdict: Boolean(await prover.verifyAndEmit.staticCall(...args)),
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
  assertTestnetOnly();
  const startedAt = new Date().toISOString();
  const source = rpcProvider(networkConfig.source.rpcUrl);
  const cc3 = rpcProvider(networkConfig.destination.rpcUrl);
  const prover = new Contract(networkConfig.destination.blockProver, ABI, cc3);
  try {
  const [rawHealth, attestedResponse, sourceNetwork, destinationNetwork, sourceHead] = await Promise.all([
    getJson(`${networkConfig.proofApiUrl}/health`),
    getJson(`${networkConfig.proofApiUrl}/attested-height/${networkConfig.source.attestcoinChainKey}`),
    source.getNetwork(),
    cc3.getNetwork(),
    source.getBlockNumber(),
  ]);
  const health = assertHealthyProofApi(rawHealth);
  if (sourceNetwork.chainId !== networkConfig.source.evmChainId) throw new Error('Source chainId mismatch');
  if (destinationNetwork.chainId !== networkConfig.destination.evmChainId) throw new Error('CC3 chainId mismatch');

  const attestedHeight = Number(attestedResponse.attestedHeight);
  const suppliedTx = getArg('--tx');
  const sample = suppliedTx
    ? { txHash: suppliedTx, height: Number((await source.getTransaction(suppliedTx))?.blockNumber) }
    : await findSampleTransaction(source, attestedHeight - 500);
  if (!sample.txHash || !Number.isSafeInteger(sample.height)) throw new Error('Transaction is missing or unmined');
  if (sample.height > attestedHeight) throw new Error('Transaction block is not attested yet');

  const proof = await getJson(
    `${networkConfig.proofApiUrl}/proof-by-tx/${networkConfig.source.attestcoinChainKey}/${sample.txHash}`,
  );
  const args = verifierArgs(proof);
  const derivedIndex = await prover.calculateTxIndex(args[3]);
  const normal = await callVerifier(prover, args);

  const rootTampered = structuredClone(proof);
  rootTampered.merkleProof.root = `0x${'11'.repeat(32)}`;
  const continuityTampered = structuredClone(proof);
  continuityTampered.continuityProof.lowerEndpointDigest = `0x${'22'.repeat(32)}`;
  const [badRoot, badContinuity] = await Promise.all([
    callVerifier(prover, verifierArgs(rootTampered)),
    callVerifier(prover, verifierArgs(continuityTampered)),
  ]);

  const evidence = {
    classification: classifyProbe({
      normalVerdict: normal.verdict,
      rootTamperedVerdict: badRoot.verdict,
      continuityTamperedVerdict: badContinuity.verdict,
      derivedIndex,
      proofIndex: proof.txIndex,
      proofHeight: proof.headerNumber,
      sourceHeight: sample.height,
      proofChainKey: proof.chainKey,
      expectedChainKey: networkConfig.source.attestcoinChainKey,
    }),
    startedAt,
    completedAt: new Date().toISOString(),
    endpoints: {
      sourceRpc: networkConfig.source.rpcUrl,
      destinationRpc: networkConfig.destination.rpcUrl,
      proofApi: networkConfig.proofApiUrl,
      blockProver: networkConfig.destination.blockProver,
    },
    mapping: { sourceEvmChainId: '11155111', destinationEvmChainId: '102031', chainKey: '1' },
    health,
    sourceHead,
    attestedHeight,
    attestationLagBlocks: sourceHead - attestedHeight,
    txHash: sample.txHash,
    blockNumber: sample.height,
    proof: {
      headerNumber: proof.headerNumber,
      txIndex: proof.txIndex,
      derivedIndex: derivedIndex.toString(),
      cached: proof.cached,
      txBytesLength: (proof.txBytes.length - 2) / 2,
      merkleSiblingCount: proof.merkleProof.siblings.length,
      continuityRootCount: proof.continuityProof.roots.length,
    },
    runtime: { normal, rootTampered: badRoot, continuityTampered: badContinuity },
    note: 'eth_call verified runtime behavior only; it did not persist application storage or prove E2E deployment.',
  };

  const outputDirectory = path.join(process.cwd(), 'runs', 'probe');
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${startedAt.replaceAll(':', '-')}.json`);
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
  console.error('BLOCKED', safeError(error));
  process.exitCode = 1;
});
