'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Contract, JsonRpcProvider, Wallet } = require('ethers');
const { networkConfig } = require('../src/config');
const { verifierArgs } = require('../src/proof-client');
const { submissionRecord } = require('../src/cc3-run');

function runId() {
  const index = process.argv.indexOf('--run');
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Usage: node scripts/submit-proof.js --run <runId>');
  return value;
}

async function main() {
  require('dotenv').config({ quiet: true });
  const id = runId();
  const root = path.join(__dirname, '..');
  const manifestPath = path.join(root, 'runs', id, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.destination?.gate?.address) throw new Error('destination gate is not deployed');
  if (manifest.destination.submission) throw new Error('proof was already submitted for this run');
  const evidence = JSON.parse(fs.readFileSync(path.join(root, 'runs', id, 'proofs', 'debt-opened.json'), 'utf8'));
  if (evidence.classification !== 'VERIFIED') throw new Error('proof evidence is not VERIFIED');
  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'contracts.json'))).contracts.VerifiedDebtGate;
  const provider = new JsonRpcProvider(networkConfig.destination.rpcUrl);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== 102031n) throw new Error(`Refusing non-CC3 chainId ${network.chainId}`);
    const signer = new Wallet(process.env.PRIVATE_KEY, provider);
    const gate = new Contract(manifest.destination.gate.address, artifact.abi, signer);
    const transaction = await gate.submitSourceTransaction(...verifierArgs(evidence.bundle));
    const receipt = await transaction.wait();
    const state = await gate.getState();
    manifest.destination.submission = submissionRecord({ txHash: transaction.hash, blockNumber: receipt.blockNumber, status: receipt.status, state });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(manifest.destination.submission, null, 2));
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(`CC3_SUBMISSION_FAILED: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
