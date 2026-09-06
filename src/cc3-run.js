'use strict';

const { getAddress } = require('ethers');

function destinationConstructorArgs({ manifest, verifier, decoder }) {
  return [
    getAddress(verifier),
    getAddress(decoder),
    1n,
    11155111n,
    getAddress(manifest.source.contractAddress),
    manifest.source.assetId,
    manifest.opening.loanId,
    manifest.source.unitId,
    getAddress(manifest.source.borrower),
    getAddress(manifest.source.borrower),
    60_000_000n,
  ];
}

function submissionRecord({ txHash, blockNumber, status, state }) {
  if (Number(status) !== 1) throw new Error('CC3 submission receipt failed');
  const [initialized, principal, repaid, debt, sequence, sourceBlock, txIndex, stateVersion] = state;
  if (
    !initialized || principal !== 50_000_000n || repaid !== 0n || debt !== 50_000_000n ||
    sequence !== 1n || sourceBlock !== 11_643_709n || txIndex !== 80n || stateVersion !== 1n
  ) throw new Error('CC3 stored state does not match T07 acceptance');
  return {
    transactionHash: txHash,
    blockNumber,
    receiptStatus: Number(status),
    initialized,
    principalOpened: principal.toString(),
    totalRepaid: repaid.toString(),
    verifiedDebt: debt.toString(),
    lastSequence: sequence.toString(),
    lastSourceBlock: sourceBlock.toString(),
    lastTxIndex: txIndex.toString(),
    stateVersion: stateVersion.toString(),
  };
}

module.exports = { destinationConstructorArgs, submissionRecord };
