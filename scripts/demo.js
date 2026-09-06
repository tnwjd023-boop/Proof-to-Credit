'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Contract, JsonRpcProvider, Wallet } = require('ethers');
const { networkConfig } = require('../src/config');
const { assertScenario } = require('../src/scenario-result');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function serialDecision(decision) {
  return {
    allowed: decision.allowed,
    reason: decision.reason.toString(),
    observedHeadroom: decision.observedHeadroom.toString(),
    proposedUtilization: decision.proposedUtilization.toString(),
    stateHash: decision.stateHash,
    stateVersion: decision.stateVersion.toString(),
    policyVersion: decision.policyVersion.toString(),
  };
}

async function main() {
  require('dotenv').config({ quiet: true });
  const id = option('--run');
  const slot = option('--slot') || 'destinationT12';
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || !/^destination[A-Za-z0-9]*$/.test(slot)) {
    throw new Error('Usage: node scripts/demo.js --run <runId> --slot destinationT12 --mode testnet');
  }
  if (option('--mode') !== 'testnet') throw new Error('Only --mode testnet is allowed');
  const root = path.join(__dirname, '..');
  const manifestPath = path.join(root, 'runs', id, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const destination = manifest[slot];
  if (!destination?.submissions?.['debt-opened'] || !destination.submissions['debt-repaid']) {
    throw new Error('opening and repayment proofs must be submitted first');
  }
  if (destination.demo) throw new Error('demo commitment already exists');
  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'contracts.json'))).contracts.VerifiedDebtGate;
  const provider = new JsonRpcProvider(networkConfig.destination.rpcUrl);
  try {
    if ((await provider.getNetwork()).chainId !== 102031n) throw new Error('Refusing non-CC3 network');
    const signer = new Wallet(process.env.PRIVATE_KEY, provider);
    const gate = new Contract(destination.gate.address, artifact.abi, signer);
    const beforeRepayment = await gate.evaluate.staticCall(30_000_000n, { blockTag: destination.submissions['debt-opened'].blockNumber });
    const afterRepayment = await gate.evaluate(30_000_000n);
    const state = await gate.getState();
    if (state.stateVersion_ !== 2n || state.verifiedDebt_ !== 30_000_000n) throw new Error('gate is not at debt30 version2');
    const transaction = await gate.commitCredit(30_000_000n, state.stateVersion_, await gate.policyVersion());
    const receipt = await transaction.wait();
    if (receipt.status !== 1) throw new Error('commitCredit receipt failed');
    const afterCommit = await gate.evaluate(1n);
    const committedCredit = await gate.committedCredit();
    const verdict = assertScenario({ beforeRepayment, afterRepayment, afterCommit, committedCredit });
    destination.demo = {
      ...verdict,
      commitTransactionHash: transaction.hash,
      commitBlockNumber: receipt.blockNumber,
      receiptStatus: Number(receipt.status),
      decisions: {
        beforeRepayment: serialDecision(beforeRepayment),
        afterRepayment: serialDecision(afterRepayment),
        afterCommit: serialDecision(afterCommit),
      },
      verifiedAt: new Date().toISOString(),
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(destination.demo, null, 2));
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(`DEMO_FAILED: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
