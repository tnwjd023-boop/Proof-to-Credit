'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Interface, keccak256, toUtf8Bytes } = require('ethers');
const {
  OPEN_AMOUNT,
  SOURCE_ASSET_ID,
  SOURCE_UNIT_ID,
  deploymentRecord,
  openingRecord,
  repaymentRecord,
} = require('../src/source-run');

const address = '0x1000000000000000000000000000000000000001';
const contractAddress = '0x2000000000000000000000000000000000000002';
const txHash = `0x${'ab'.repeat(32)}`;
const code = '0x6001600055';

test('source constants fix the documented identity and six-decimal open50 amount', () => {
  assert.equal(SOURCE_ASSET_ID, keccak256(toUtf8Bytes('DEMO_GOLD_REFERENCE_001')));
  assert.equal(SOURCE_UNIT_ID, keccak256(toUtf8Bytes('DEMO_USD_6')));
  assert.equal(OPEN_AMOUNT, 50_000_000n);
});

test('repayment record accepts only a matching repay20 event and debt30 state', () => {
  const iface = new Interface([
    'event DebtRepaid(bytes32 indexed assetId,bytes32 indexed loanId,address indexed borrower,bytes32 unitId,uint64 sequence,uint256 amount,uint256 cumulativeRepaid,uint256 outstanding,uint64 sourceTimestamp)',
  ]);
  const loanId = `0x${'12'.repeat(32)}`;
  const event = iface.encodeEventLog(iface.getEvent('DebtRepaid'), [
    SOURCE_ASSET_ID, loanId, address, SOURCE_UNIT_ID, 2n, 20_000_000n, 20_000_000n, 30_000_000n, 124n,
  ]);
  const record = repaymentRecord({
    receipt: { status: 1, hash: txHash, blockNumber: 43, logs: [{ address: contractAddress, ...event }] },
    contractAddress,
    borrower: address,
    loanId,
    iface,
  });
  assert.equal(record.amount, '20000000');
  assert.equal(record.outstanding, '30000000');
  assert.equal(record.sequence, '2');
});

test('deployment record rejects the wrong network or bytecode', () => {
  assert.throws(
    () => deploymentRecord({ chainId: 1n, address: contractAddress, txHash, code, expectedCode: code }),
    /Sepolia/,
  );
  assert.throws(
    () => deploymentRecord({ chainId: 11155111n, address: contractAddress, txHash, code: '0x', expectedCode: code }),
    /bytecode/,
  );
});

test('opening record accepts only a successful matching DebtOpened receipt', () => {
  const iface = new Interface([
    'event DebtOpened(bytes32 indexed assetId,bytes32 indexed loanId,address indexed borrower,bytes32 unitId,uint64 sequence,uint256 principal,uint256 outstanding,uint64 sourceTimestamp)',
  ]);
  const loanId = `0x${'12'.repeat(32)}`;
  const event = iface.encodeEventLog(iface.getEvent('DebtOpened'), [
    SOURCE_ASSET_ID,
    loanId,
    address,
    SOURCE_UNIT_ID,
    1n,
    OPEN_AMOUNT,
    OPEN_AMOUNT,
    123n,
  ]);
  const record = openingRecord({
    receipt: { status: 1, hash: txHash, blockNumber: 42, logs: [{ address: contractAddress, ...event }] },
    contractAddress,
    borrower: address,
    iface,
  });
  assert.equal(record.transactionHash, txHash);
  assert.equal(record.loanId, loanId);
  assert.equal(record.principal, OPEN_AMOUNT.toString());
  assert.equal(record.sequence, '1');
});
