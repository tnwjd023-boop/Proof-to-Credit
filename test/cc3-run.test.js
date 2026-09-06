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
  });
  assert.equal(record.verifiedDebt, '50000000');
  assert.equal(record.stateVersion, '1');
  assert.throws(() => submissionRecord({ txHash: '0x', blockNumber: 7, status: 0, state: [] }), /receipt/);
});
