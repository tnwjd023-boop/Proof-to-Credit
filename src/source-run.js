'use strict';

const { getAddress, keccak256, toUtf8Bytes } = require('ethers');

const SOURCE_CHAIN_ID = 11155111n;
const SOURCE_ASSET_ID = keccak256(toUtf8Bytes('DEMO_GOLD_REFERENCE_001'));
const SOURCE_UNIT_ID = keccak256(toUtf8Bytes('DEMO_USD_6'));
const OPEN_AMOUNT = 50_000_000n;

function deploymentRecord({ chainId, address, txHash, code, expectedCode, borrower }) {
  if (BigInt(chainId) !== SOURCE_CHAIN_ID) throw new Error('Sepolia chainId 11155111 required');
  if (!code || code === '0x' || code.length !== expectedCode.length) {
    throw new Error('deployed bytecode is missing or has an unexpected length');
  }
  return {
    network: 'Ethereum Sepolia',
    chainId: SOURCE_CHAIN_ID.toString(),
    contractAddress: getAddress(address),
    deploymentTransactionHash: txHash,
    borrower: borrower ? getAddress(borrower) : undefined,
    assetId: SOURCE_ASSET_ID,
    unitId: SOURCE_UNIT_ID,
    deployedCodeHash: keccak256(code),
    deployedCodeBytes: (code.length - 2) / 2,
  };
}

function openingRecord({ receipt, contractAddress, borrower, iface }) {
  if (Number(receipt.status) !== 1) throw new Error('DebtOpened transaction receipt failed');
  const target = getAddress(contractAddress);
  const expectedBorrower = getAddress(borrower);
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== target) continue;
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== 'DebtOpened') continue;
    const args = parsed.args;
    if (
      args.assetId !== SOURCE_ASSET_ID ||
      args.unitId !== SOURCE_UNIT_ID ||
      getAddress(args.borrower) !== expectedBorrower ||
      args.sequence !== 1n ||
      args.principal !== OPEN_AMOUNT ||
      args.outstanding !== OPEN_AMOUNT
    ) {
      throw new Error('DebtOpened event does not match the fixed T05 scope');
    }
    return {
      transactionHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      loanId: args.loanId,
      sequence: args.sequence.toString(),
      principal: args.principal.toString(),
      outstanding: args.outstanding.toString(),
      sourceTimestamp: args.sourceTimestamp.toString(),
    };
  }
  throw new Error('matching DebtOpened event not found');
}

module.exports = {
  OPEN_AMOUNT,
  SOURCE_ASSET_ID,
  SOURCE_CHAIN_ID,
  SOURCE_UNIT_ID,
  deploymentRecord,
  openingRecord,
};
