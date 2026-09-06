'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Contract, JsonRpcProvider, Wallet, keccak256, parseUnits } = require('ethers');
const { SOURCE_CHAIN_ID, openingRecord, repaymentRecord } = require('../src/source-run');
const {
  classifyPendingReceipt,
  clearPending,
  recordPending,
  validatePendingTransaction,
  writeJsonAtomic,
} = require('../src/evidence');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  require('dotenv').config({ quiet: true });
  const action = process.argv[2];
  const expectedAmount = action === 'open' ? '50' : action === 'repay' ? '20' : undefined;
  if (!expectedAmount || option('--amount') !== expectedAmount) throw new Error('Usage: source-actions.js <open --amount 50|repay --amount 20> --run <runId>');
  const id = option('--run');
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('A safe --run value is required');
  const manifestPath = path.join(__dirname, '..', 'runs', id, 'manifest.json');
  let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const recordKey = action === 'open' ? 'opening' : 'repayment';
  const pendingKind = action === 'open' ? 'source-open' : 'source-repay';
  if (manifest[recordKey]) {
    console.log(JSON.stringify({ status: 'COMPLETE', [recordKey]: manifest[recordKey] }, null, 2));
    return;
  }
  if (manifest.pending && manifest.pending.kind !== pendingKind) throw new Error('a different source transaction must be recovered first');
  if (action === 'repay' && !manifest.opening) throw new Error('Repayment requires one opening');
  const artifacts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts.json'), 'utf8'));
  const artifact = artifacts.contracts.SingleDrawLoanMock;
  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== SOURCE_CHAIN_ID) throw new Error(`Refusing non-Sepolia chainId ${network.chainId}`);
    const readOnly = new Contract(manifest.source.contractAddress, artifact.abi, provider);
    let transaction;
    let receipt;
    if (manifest.pending) {
      transaction = await provider.getTransaction(manifest.pending.transactionHash);
      validatePendingTransaction(transaction, manifest.pending);
      receipt = await provider.getTransactionReceipt(manifest.pending.transactionHash);
    } else {
      const signer = new Wallet(process.env.PRIVATE_KEY, provider);
      if (signer.address !== manifest.source.borrower) throw new Error('Signer is not the recorded borrower');
      const contract = readOnly.connect(signer);
      transaction = action === 'open'
        ? await contract.openDebt(parseUnits('50', 6))
        : await contract.repayDebt(parseUnits('20', 6));
      manifest = recordPending(manifest, null, {
        kind: pendingKind,
        transactionHash: transaction.hash,
        from: transaction.from,
        to: manifest.source.contractAddress,
        chainId: transaction.chainId.toString(),
        dataHash: keccak256(transaction.data),
        value: transaction.value.toString(),
        sentAt: new Date().toISOString(),
      });
      writeJsonAtomic(manifestPath, manifest);
      receipt = await transaction.wait();
    }
    const status = classifyPendingReceipt(receipt, manifest.pending);
    if (status === 'PENDING') throw new Error(`source ${action} is still pending; no replacement was sent`);
    if (status === 'REVERTED') throw new Error(`source ${action} reverted; pending evidence was retained`);
    if (action === 'open') {
      manifest.opening = openingRecord({ receipt, contractAddress: manifest.source.contractAddress, borrower: manifest.source.borrower, iface: readOnly.interface });
    } else {
      manifest.repayment = repaymentRecord({ receipt, contractAddress: manifest.source.contractAddress, borrower: manifest.source.borrower, loanId: manifest.opening.loanId, iface: readOnly.interface });
    }
    const state = await readOnly.getLoanState({ blockTag: receipt.blockNumber });
    const expectedRepaid = action === 'open' ? 0n : parseUnits('20', 6);
    const expectedOutstanding = action === 'open' ? parseUnits('50', 6) : parseUnits('30', 6);
    const expectedSequence = action === 'open' ? 1n : 2n;
    if (!state.opened_ || state.principalOpened_ !== parseUnits('50', 6) || state.totalRepaid_ !== expectedRepaid || state.outstanding_ !== expectedOutstanding || state.sequence_ !== expectedSequence) {
      throw new Error(`on-chain source state does not match ${action}`);
    }
    manifest[recordKey].confirmedState = {
      opened: state.opened_,
      principalOpened: state.principalOpened_.toString(),
      totalRepaid: state.totalRepaid_.toString(),
      outstanding: state.outstanding_.toString(),
      sequence: state.sequence_.toString(),
    };
    manifest = clearPending(manifest, null, pendingKind, receipt.hash);
    writeJsonAtomic(manifestPath, manifest);
    console.log(JSON.stringify({ status: 'CONFIRMED', [recordKey]: manifest[recordKey] }, null, 2));
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(`SOURCE_ACTION_FAILED: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
