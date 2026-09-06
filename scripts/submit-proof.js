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

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  require('dotenv').config({ quiet: true });
  const id = runId();
  const slot = option('--slot') || 'destination';
  const proofKind = option('--proof') || 'debt-opened';
  if (!/^destination[A-Za-z0-9]*$/.test(slot) || !['debt-opened', 'debt-repaid'].includes(proofKind)) throw new Error('Invalid --slot or --proof');
  const root = path.join(__dirname, '..');
  const manifestPath = path.join(root, 'runs', id, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const destination = manifest[slot];
  if (!destination?.gate?.address) throw new Error('destination gate is not deployed');
  destination.submissions ||= {};
  if (destination.submissions[proofKind]) throw new Error(`${proofKind} was already submitted for this destination`);
  const evidence = JSON.parse(fs.readFileSync(path.join(root, 'runs', id, 'proofs', `${proofKind}.json`), 'utf8'));
  if (evidence.classification !== 'VERIFIED') throw new Error('proof evidence is not VERIFIED');
  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'contracts.json'))).contracts.VerifiedDebtGate;
  const provider = new JsonRpcProvider(networkConfig.destination.rpcUrl);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== 102031n) throw new Error(`Refusing non-CC3 chainId ${network.chainId}`);
    const signer = new Wallet(process.env.PRIVATE_KEY, provider);
    const gate = new Contract(destination.gate.address, artifact.abi, signer);
    const transaction = await gate.submitSourceTransaction(...verifierArgs(evidence.bundle));
    const receipt = await transaction.wait();
    const state = await gate.getState();
    const expected = proofKind === 'debt-opened'
      ? undefined
      : { repaid: 20_000_000n, debt: 30_000_000n, sequence: 2n, sourceBlock: 11_643_980n, txIndex: 77n, stateVersion: 2n };
    destination.submissions[proofKind] = submissionRecord({ txHash: transaction.hash, blockNumber: receipt.blockNumber, status: receipt.status, state, expected });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(destination.submissions[proofKind], null, 2));
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(`CC3_SUBMISSION_FAILED: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
