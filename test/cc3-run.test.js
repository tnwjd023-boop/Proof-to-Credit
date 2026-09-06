'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../runs/20260906-t05/manifest.json');
const { destinationConstructorArgs, submissionRecord } = require('../src/cc3-run');

const verifier = '0x0000000000000000000000000000000000000FD2';
const decoder = '0x2000000000000000000000000000000000000002';

test('destination constructor fixes verifier, source identity, owner, and limit60', () => {
  const args = destinationConstructorArgs({ manifest, verifier, decoder });
  assert.deepEqual(args, [
    verifier,
    decoder,
    1n,
    11155111n,
    manifest.source.contractAddress,
    manifest.source.assetId,
    manifest.opening.loanId,
    manifest.source.unitId,
    manifest.source.borrower,
    manifest.source.borrower,
    60_000_000n,
  ]);
});

test('submission record requires successful initialized debt50 state', () => {
  const record = submissionRecord({
    txHash: `0x${'ab'.repeat(32)}`,
    blockNumber: 7,
    status: 1,
    state: [true, 50_000_000n, 0n, 50_000_000n, 1n, 11_643_709n, 80n, 1n],
    expected: { principal: 50_000_000n, repaid: 0n, debt: 50_000_000n, sequence: 1n, sourceBlock: 11_643_709n, txIndex: 80n, stateVersion: 1n },
  });
  assert.equal(record.verifiedDebt, '50000000');
  assert.equal(record.stateVersion, '1');
  assert.throws(() => submissionRecord({ txHash: '0x', blockNumber: 7, status: 0, state: [] }), /receipt/);
  assert.throws(() => submissionRecord({
    txHash: '0x', blockNumber: 7, status: 1,
    state: [true, 50_000_000n, 0n, 50_000_000n, 1n, 11_643_709n, 80n, 1n],
  }), /expected acceptance state is required/);
});

test('submission record validates the expected repayment state', () => {
  const record = submissionRecord({
    txHash: `0x${'cd'.repeat(32)}`,
    blockNumber: 8,
    status: 1,
    state: [true, 50_000_000n, 20_000_000n, 30_000_000n, 2n, 11_643_980n, 77n, 2n],
    expected: { principal: 50_000_000n, repaid: 20_000_000n, debt: 30_000_000n, sequence: 2n, sourceBlock: 11_643_980n, txIndex: 77n, stateVersion: 2n },
  });
  assert.equal(record.totalRepaid, '20000000');
  assert.equal(record.verifiedDebt, '30000000');
});

test('submission record accepts manifest-derived values without T05 numeric defaults', () => {
  const record = submissionRecord({
    txHash: `0x${'ef'.repeat(32)}`,
    blockNumber: 9,
    status: 1,
    state: [true, 700n, 250n, 450n, 2n, 202n, 11n, 2n],
    expected: { principal: 700n, repaid: 250n, debt: 450n, sequence: 2n, sourceBlock: 202n, txIndex: 11n, stateVersion: 2n },
  });
  assert.equal(record.principalOpened, '700');
  assert.equal(record.totalRepaid, '250');
  assert.equal(record.verifiedDebt, '450');
});
