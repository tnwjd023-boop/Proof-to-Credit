'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Contract, FetchRequest, JsonRpcProvider, Wallet, keccak256 } = require('ethers');
const { networkConfig } = require('../src/config');
const { ensureFreshProof, fetchProof, normalizeProof, verifierArgs } = require('../src/proof-client');
const { submissionRecord } = require('../src/cc3-run');
const {
  classifyPendingReceipt,
  deriveExpectedSubmission,
  finalizePending,
  proofUseStatus,
  recordPending,
  validatePendingTransaction,
  writeJsonAtomic,
} = require('../src/evidence');
const { buildTamperedProofs, runtimeProofVerdict } = require('../src/runtime-negative');

const MERKLE = '(bytes32 root,(bytes32 hash,bool isLeft)[] siblings)';
const CONTINUITY = '(bytes32 lowerEndpointDigest,bytes32[] roots)';
const VERIFIER_ABI = [
  `function verify(uint64,uint64,bytes,${MERKLE},${CONTINUITY}) view returns (bool)`,
  `function verifyAndEmit(uint64,uint64,bytes,${MERKLE},${CONTINUITY}) returns (bool)`,
  `function calculateTxIndex(${MERKLE}) view returns (uint64)`,
];

function runId() {
  const index = process.argv.indexOf('--run');
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Usage: node scripts/submit-proof.js --run <runId>');
  return value;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function provider(url) {
  const request = new FetchRequest(url);
  request.timeout = 15_000;
  return new JsonRpcProvider(request);
}

async function main() {
  require('dotenv').config({ quiet: true });
  const id = runId();
  const slot = option('--slot') || 'destination';
  const proofKind = option('--proof') || 'debt-opened';
  if (!/^destination[A-Za-z0-9]*$/.test(slot) || !['debt-opened', 'debt-repaid'].includes(proofKind)) throw new Error('Invalid --slot or --proof');
  const root = path.join(__dirname, '..');
  const manifestPath = path.join(root, 'runs', id, 'manifest.json');
  let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const destination = manifest[slot];
  if (!destination?.gate?.address) throw new Error('destination gate is not deployed');
  destination.submissions ||= {};
  const useStatus = proofUseStatus(destination, proofKind);
  if (useStatus === 'ALREADY_SUBMITTED') {
    console.log(JSON.stringify({ status: 'COMPLETE', proofKind, submission: destination.submissions[proofKind] }, null, 2));
    return;
  }

  const proofPath = path.join(root, 'runs', id, 'proofs', `${proofKind}.json`);
  let evidence = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  if (evidence.classification !== 'VERIFIED') throw new Error('proof evidence is not VERIFIED');
  const sourceRecord = proofKind === 'debt-opened' ? manifest.opening : manifest.repayment;
  if (!sourceRecord?.transactionHash || evidence.sourceTransactionHash.toLowerCase() !== sourceRecord.transactionHash.toLowerCase()) {
    throw new Error('proof source transaction does not match run manifest');
  }

  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'contracts.json'))).contracts.VerifiedDebtGate;
  const cc3 = provider(networkConfig.destination.rpcUrl);
  try {
    const network = await cc3.getNetwork();
    if (network.chainId !== networkConfig.destination.evmChainId) throw new Error(`Refusing non-CC3 chainId ${network.chainId}`);
    const gateReadOnly = new Contract(destination.gate.address, artifact.abi, cc3);

    if (useStatus === 'RECOVER_PENDING') {
      const transaction = await cc3.getTransaction(destination.pending.transactionHash);
      validatePendingTransaction(transaction, destination.pending);
      const receipt = await cc3.getTransactionReceipt(destination.pending.transactionHash);
      const status = classifyPendingReceipt(receipt, destination.pending);
      if (status === 'PENDING') throw new Error('recorded transaction is still pending; no replacement was sent');
      if (status === 'REVERTED') throw new Error('recorded transaction reverted; pending evidence was retained');
      const proof = normalizeProof(evidence.bundle, { chainKey: networkConfig.source.attestcoinChainKey, headerNumber: sourceRecord.blockNumber });
      const expected = deriveExpectedSubmission(manifest, proofKind, proof);
      const state = await gateReadOnly.getState({ blockTag: receipt.blockNumber });
      const record = submissionRecord({ txHash: receipt.hash, blockNumber: receipt.blockNumber, status: receipt.status, state, expected });
      manifest = finalizePending(manifest, slot, proofKind, record);
      writeJsonAtomic(manifestPath, manifest);
      console.log(JSON.stringify({ status: 'RECOVERED', proofKind, submission: record }, null, 2));
      return;
    }

    const prover = new Contract(networkConfig.destination.blockProver, VERIFIER_ABI, cc3);
    const verifyProof = async (candidate) => {
      const proof = normalizeProof(candidate, {
        chainKey: networkConfig.source.attestcoinChainKey,
        headerNumber: sourceRecord.blockNumber,
      });
      if (BigInt(proof.txIndex) !== BigInt(evidence.sourceTransactionIndex)) return false;
      const args = verifierArgs(proof);
      const derivedIndex = await prover.calculateTxIndex(args[3]);
      return derivedIndex === BigInt(proof.txIndex) && runtimeProofVerdict(prover, args);
    };
    const freshness = await ensureFreshProof({
      savedProof: evidence.bundle,
      verifyProof,
      refreshProof: () => fetchProof({
        baseUrl: networkConfig.proofApiUrl,
        chainKey: networkConfig.source.attestcoinChainKey,
        txHash: sourceRecord.transactionHash,
        headerNumber: BigInt(sourceRecord.blockNumber),
        onProgress: ({ status, message }) => console.log(`WAITING HTTP ${status}: ${message}`),
      }),
    });
    const proof = normalizeProof(freshness.proof, {
      chainKey: networkConfig.source.attestcoinChainKey,
      headerNumber: sourceRecord.blockNumber,
    });

    if (freshness.refreshed) {
      const args = verifierArgs(proof);
      const { rootTampered, bytesTampered, continuityTampered } = buildTamperedProofs(proof);
      const [derivedIndex, normal, badRoot, badBytes, badContinuity] = await Promise.all([
        prover.calculateTxIndex(args[3]),
        runtimeProofVerdict(prover, args),
        runtimeProofVerdict(prover, verifierArgs(rootTampered)),
        runtimeProofVerdict(prover, verifierArgs(bytesTampered)),
        runtimeProofVerdict(prover, verifierArgs(continuityTampered)),
      ]);
      if (derivedIndex !== BigInt(proof.txIndex) || !normal || badRoot || badBytes || badContinuity) {
        throw new Error('refreshed proof did not satisfy runtime positive and negative controls');
      }
      evidence = {
        ...evidence,
        bundle: proof,
        flattened: {
          chainKey: proof.chainKey,
          headerNumber: proof.headerNumber,
          txBytes: proof.txBytes,
          merkleProof: proof.merkleProof,
          continuityProof: proof.continuityProof,
        },
        runtime: {
          derivedIndex: derivedIndex.toString(),
          normal: { method: 'submission-preflight', verdict: normal },
          rootTampered: { method: 'submission-preflight', verdict: badRoot },
          bytesTampered: { method: 'submission-preflight', verdict: badBytes },
          continuityTampered: { method: 'submission-preflight', verdict: badContinuity },
        },
        refreshedAt: new Date().toISOString(),
      };
      writeJsonAtomic(proofPath, evidence);
    }

    // No signer exists until the exact bundle has passed the read-only runtime preflight.
    const signer = new Wallet(process.env.PRIVATE_KEY, cc3);
    if (signer.address !== manifest.source.borrower) throw new Error('signer does not match run borrower');
    const gate = gateReadOnly.connect(signer);
    const transaction = await gate.submitSourceTransaction(...verifierArgs(proof));
    manifest = recordPending(manifest, slot, {
      kind: proofKind,
      transactionHash: transaction.hash,
      from: transaction.from,
      to: destination.gate.address,
      chainId: transaction.chainId.toString(),
      dataHash: keccak256(transaction.data),
      value: transaction.value.toString(),
      sentAt: new Date().toISOString(),
    });
    writeJsonAtomic(manifestPath, manifest);

    const receipt = await transaction.wait();
    const status = classifyPendingReceipt(receipt, manifest[slot].pending);
    if (status !== 'CONFIRMED') throw new Error(`submission transaction ${status.toLowerCase()}; pending evidence was retained`);
    const state = await gateReadOnly.getState({ blockTag: receipt.blockNumber });
    const expected = deriveExpectedSubmission(manifest, proofKind, proof);
    const record = submissionRecord({ txHash: transaction.hash, blockNumber: receipt.blockNumber, status: receipt.status, state, expected });
    manifest = finalizePending(manifest, slot, proofKind, record);
    writeJsonAtomic(manifestPath, manifest);
    console.log(JSON.stringify({ status: 'CONFIRMED', proofKind, refreshedProof: freshness.refreshed, submission: record }, null, 2));
  } finally {
    cc3.destroy();
  }
}

main().catch((error) => {
  console.error(`CC3_SUBMISSION_FAILED: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
