'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVmHarness } = require('./helpers/vm');
const { verifierArgs } = require('../src/proof-client');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'manifest.json')));
const opening = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'proofs', 'debt-opened.json'))).bundle;
const repayment = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'proofs', 'debt-repaid.json'))).bundle;
const owner = '0x3000000000000000000000000000000000000003';
const outsider = '0x4000000000000000000000000000000000000004';

async function setup({ initialized = true } = {}) {
  const harness = await createVmHarness({ caller: owner });
  const verifier = await harness.deploy('TestOnlyVerifierMock', [true]);
  const decoder = await harness.deploy('EvmV1Decoder', []);
  const gate = await harness.deploy('VerifiedDebtGate', [
    verifier.address, decoder.address, 1n, 11155111n, manifest.source.contractAddress,
    manifest.source.assetId, manifest.opening.loanId, manifest.source.unitId,
    manifest.source.borrower, owner, 60_000_000n,
  ]);
  if (initialized) {
    await gate.write('submitSourceTransaction', verifierArgs(opening));
    await gate.write('submitSourceTransaction', verifierArgs(repayment));
  }
  return gate;
}

test('borrower atomically commits the exact debt30 headroom and consumes it', async () => {
  const gate = await setup();
  const previousHash = await gate.readOne('stateHash');
  const committed = await gate.write('commitCredit', [30_000_000n, 2n, 1n], { caller: manifest.source.borrower });
  assert.equal(await gate.readOne('committedCredit'), 30_000_000n);
  assert.equal(await gate.readOne('stateVersion'), 3n);
  assert.equal(committed.events[0].name, 'CreditCommitted');
  assert.equal(committed.events[0].args.previousStateHash, previousHash);
  assert.equal(committed.events[0].args.committedCredit, 30_000_000n);
  const decision = await gate.readOne('evaluate', [1n]);
  assert.equal(decision.allowed, false);
  assert.equal(decision.observedHeadroom, 0n);
  await assert.rejects(
    () => gate.write('commitCredit', [1n, 3n, 1n], { caller: manifest.source.borrower }),
    /CreditLimitExceeded/,
  );
});

test('same-version competing requests allow only the first state transition', async () => {
  const gate = await setup();
  await gate.write('commitCredit', [10_000_000n, 2n, 1n], { caller: manifest.source.borrower });
  await assert.rejects(
    () => gate.write('commitCredit', [10_000_000n, 2n, 1n], { caller: manifest.source.borrower }),
    /StaleStateVersion/,
  );
  assert.equal(await gate.readOne('committedCredit'), 10_000_000n);
});

test('policy change invalidates old policy version and authorization is rechecked', async () => {
  const gate = await setup();
  await gate.write('setPolicy', [70_000_000n], { caller: owner });
  await assert.rejects(
    () => gate.write('commitCredit', [1n, 2n, 1n], { caller: manifest.source.borrower }),
    /StalePolicyVersion/,
  );
  await assert.rejects(() => gate.write('commitCredit', [1n, 2n, 2n], { caller: outsider }), /NotBorrower/);
  assert.equal(await gate.readOne('committedCredit'), 0n);
});

test('uninitialized, zero, and over-limit commits fail without mutation', async () => {
  const empty = await setup({ initialized: false });
  await assert.rejects(() => empty.write('commitCredit', [1n, 0n, 1n], { caller: manifest.source.borrower }), /Uninitialized/);
  const gate = await setup();
  await assert.rejects(() => gate.write('commitCredit', [0n, 2n, 1n], { caller: manifest.source.borrower }), /ZeroCredit/);
  await assert.rejects(() => gate.write('commitCredit', [30_000_001n, 2n, 1n], { caller: manifest.source.borrower }), /CreditLimitExceeded/);
  assert.equal(await gate.readOne('stateVersion'), 2n);
  assert.equal(await gate.readOne('committedCredit'), 0n);
});
