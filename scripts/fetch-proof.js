'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Contract, FetchRequest, JsonRpcProvider } = require('ethers');
const { networkConfig } = require('../src/config');
const { fetchProof, resumableProof, selectProofTarget, verifierArgs } = require('../src/proof-client');
const { writeJsonAtomic } = require('../src/evidence');

const MERKLE = '(bytes32 root,(bytes32 hash,bool isLeft)[] siblings)';
const CONTINUITY = '(bytes32 lowerEndpointDigest,bytes32[] roots)';
const ABI = [
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

async function verify(prover, args) {
  try {
    return { method: 'verify', verdict: Boolean(await prover.verify(...args)) };
  } catch (first) {
    try {
      return { method: 'verifyAndEmit.eth_call', verdict: Boolean(await prover.verifyAndEmit.staticCall(...args)), fallbackReason: safeError(first) };
    } catch (second) {
      return { method: 'verifyAndEmit.eth_call', verdict: false, fallbackReason: safeError(first), rejection: safeError(second) };
    }
  }
}

async function main() {
  const id = option('--run');
  const txHash = option('--tx');
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || !/^0x[0-9a-fA-F]{64}$/.test(txHash || '')) {
    throw new Error('Usage: node scripts/fetch-proof.js --run <runId> --tx <transactionHash>');
  }
  const runDirectory = path.join(__dirname, '..', 'runs', id);
  const manifest = JSON.parse(fs.readFileSync(path.join(runDirectory, 'manifest.json'), 'utf8'));
  const target = selectProofTarget(manifest, txHash);
  const refresh = process.argv.includes('--refresh');
  const source = provider(networkConfig.source.rpcUrl);
  const cc3 = provider(networkConfig.destination.rpcUrl);
  try {
    const [sourceNetwork, destinationNetwork, receipt] = await Promise.all([
      source.getNetwork(),
      cc3.getNetwork(),
      source.getTransactionReceipt(txHash),
    ]);
    if (sourceNetwork.chainId !== 11155111n || destinationNetwork.chainId !== 102031n) throw new Error('testnet chainId mismatch');
    if (!receipt || receipt.status !== 1 || receipt.blockNumber !== target.record.blockNumber) throw new Error('source receipt position mismatch');
    const proofsDirectory = path.join(runDirectory, 'proofs');
    const proofPath = path.join(proofsDirectory, `${target.kind}.json`);
    let proof;
    if (fs.existsSync(proofPath)) {
      proof = resumableProof(JSON.parse(fs.readFileSync(proofPath, 'utf8')).bundle, {
        chainKey: 1n,
        headerNumber: BigInt(receipt.blockNumber),
      }, refresh);
      if (proof) console.log('Resuming from saved proof bundle');
    }
    if (!proof) {
      proof = await fetchProof({
        baseUrl: networkConfig.proofApiUrl,
        chainKey: 1n,
        txHash,
        headerNumber: BigInt(receipt.blockNumber),
        onProgress: ({ status, message }) => console.log(`WAITING HTTP ${status}: ${message}`),
      });
    }
    if (BigInt(proof.txIndex) !== BigInt(receipt.index)) throw new Error('proof txIndex does not match source receipt');
    const prover = new Contract(networkConfig.destination.blockProver, ABI, cc3);
    const args = verifierArgs(proof);
    const derivedIndex = await prover.calculateTxIndex(args[3]);
    const normal = await verify(prover, args);
    const badRoot = structuredClone(proof);
    badRoot.merkleProof.root = `0x${'11'.repeat(32)}`;
    const badContinuity = structuredClone(proof);
    badContinuity.continuityProof.lowerEndpointDigest = `0x${'22'.repeat(32)}`;
    const [rootTampered, continuityTampered] = await Promise.all([
      verify(prover, verifierArgs(badRoot)),
      verify(prover, verifierArgs(badContinuity)),
    ]);
    if (derivedIndex !== BigInt(proof.txIndex) || !normal.verdict || rootTampered.verdict || continuityTampered.verdict) {
      throw new Error('CC3 runtime proof verification did not satisfy normal and negative controls');
    }
    const evidence = {
      classification: 'VERIFIED',
      sourceTransactionHash: txHash,
      sourceBlockNumber: receipt.blockNumber,
      sourceTransactionIndex: receipt.index,
      bundle: proof,
      flattened: {
        chainKey: proof.chainKey,
        headerNumber: proof.headerNumber,
        txBytes: proof.txBytes,
        merkleProof: proof.merkleProof,
        continuityProof: proof.continuityProof,
      },
      runtime: { derivedIndex: derivedIndex.toString(), normal, rootTampered, continuityTampered },
      verifiedAt: new Date().toISOString(),
    };
    fs.mkdirSync(proofsDirectory, { recursive: true });
    writeJsonAtomic(proofPath, evidence);
    console.log(JSON.stringify({ classification: evidence.classification, proofPath, runtime: evidence.runtime }, null, 2));
  } finally {
    source.destroy();
    cc3.destroy();
  }
}

main().catch((error) => {
  console.error(`PROOF_FETCH_BLOCKED: ${safeError(error)}`);
  process.exitCode = 1;
});
