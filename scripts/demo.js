'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Contract, FetchRequest, JsonRpcProvider, Wallet, keccak256 } = require('ethers');
const { networkConfig } = require('../src/config');
const { classifyPendingReceipt, finalizePending, recordPending, validatePendingTransaction, writeJsonAtomic } = require('../src/evidence');
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

function provider(url) {
  const request = new FetchRequest(url);
  request.timeout = 15_000;
  return new JsonRpcProvider(request);
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
  let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let destination = manifest[slot];
  if (!destination?.submissions?.['debt-opened'] || !destination.submissions['debt-repaid']) {
    throw new Error('opening and repayment proofs must be submitted first');
  }
  if (destination.demo) {
    console.log(JSON.stringify({ status: 'COMPLETE', demo: destination.demo }, null, 2));
    return;
  }
  if (destination.pending && destination.pending.kind !== 'commit-credit') {
    throw new Error('a proof submission is pending and must be recovered first');
  }

  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'contracts.json'))).contracts.VerifiedDebtGate;
  const cc3 = provider(networkConfig.destination.rpcUrl);
  try {
    if ((await cc3.getNetwork()).chainId !== networkConfig.destination.evmChainId) throw new Error('Refusing non-CC3 network');
    const gateReadOnly = new Contract(destination.gate.address, artifact.abi, cc3);

    let receipt;
    if (destination.pending) {
      const transaction = await cc3.getTransaction(destination.pending.transactionHash);
      validatePendingTransaction(transaction, destination.pending);
      receipt = await cc3.getTransactionReceipt(destination.pending.transactionHash);
      const status = classifyPendingReceipt(receipt, destination.pending);
      if (status === 'PENDING') throw new Error('recorded commit is still pending; no replacement was sent');
      if (status === 'REVERTED') throw new Error('recorded commit reverted; pending evidence was retained');
    } else {
      const currentDecision = await gateReadOnly.evaluate(30_000_000n);
      const state = await gateReadOnly.getState();
      const committed = await gateReadOnly.committedCredit();
      if (!currentDecision.allowed || state.stateVersion_ !== 2n || state.verifiedDebt_ !== 30_000_000n || committed !== 0n) {
        throw new Error('gate is not at the uncommitted debt30/version2 demo state');
      }
      const signer = new Wallet(process.env.PRIVATE_KEY, cc3);
      const gate = gateReadOnly.connect(signer);
      const transaction = await gate.commitCredit(30_000_000n, state.stateVersion_, currentDecision.policyVersion);
      manifest = recordPending(manifest, slot, {
        kind: 'commit-credit',
        transactionHash: transaction.hash,
        from: transaction.from,
        to: destination.gate.address,
        chainId: transaction.chainId.toString(),
        dataHash: keccak256(transaction.data),
        value: transaction.value.toString(),
        sentAt: new Date().toISOString(),
      });
      writeJsonAtomic(manifestPath, manifest);
      receipt = await transaction.wait();
      const status = classifyPendingReceipt(receipt, manifest[slot].pending);
      if (status !== 'CONFIRMED') throw new Error(`commit transaction ${status.toLowerCase()}; pending evidence was retained`);
    }

    destination = manifest[slot];
    const beforeRepayment = await gateReadOnly.evaluate(30_000_000n, { blockTag: destination.submissions['debt-opened'].blockNumber });
    const afterRepayment = await gateReadOnly.evaluate(30_000_000n, { blockTag: destination.submissions['debt-repaid'].blockNumber });
    const afterCommit = await gateReadOnly.evaluate(1n, { blockTag: receipt.blockNumber });
    const committedCredit = await gateReadOnly.committedCredit({ blockTag: receipt.blockNumber });
    const verdict = assertScenario({ beforeRepayment, afterRepayment, afterCommit, committedCredit });
    const record = {
      ...verdict,
      commitTransactionHash: receipt.hash,
      commitBlockNumber: receipt.blockNumber,
      receiptStatus: Number(receipt.status),
      decisions: {
        beforeRepayment: serialDecision(beforeRepayment),
        afterRepayment: serialDecision(afterRepayment),
        afterCommit: serialDecision(afterCommit),
      },
      verifiedAt: new Date().toISOString(),
    };
    manifest = finalizePending(manifest, slot, 'commit-credit', record);
    writeJsonAtomic(manifestPath, manifest);
    console.log(JSON.stringify({ status: 'CONFIRMED', demo: record }, null, 2));
  } finally {
    cc3.destroy();
  }
}

main().catch((error) => {
  console.error(`DEMO_FAILED: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
