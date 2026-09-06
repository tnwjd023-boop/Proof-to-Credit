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

async function setup() {
  const harness = await createVmHarness({ caller: owner });
  const verifier = await harness.deploy('TestOnlyVerifierMock', [true]);
  const decoder = await harness.deploy('EvmV1Decoder', []);
  const gate = await harness.deploy('VerifiedDebtGate', [
    verifier.address, decoder.address, 1n, 11155111n, manifest.source.contractAddress,
    manifest.source.assetId, manifest.opening.loanId, manifest.source.unitId,
    manifest.source.borrower, owner, 60_000_000n,
  ]);
  return gate;
}

function decision(result) {
  return {
    allowed: result.allowed,
    reason: result.reason,
    headroom: result.observedHeadroom,
    proposed: result.proposedUtilization,
    stateVersion: result.stateVersion,
    policyVersion: result.policyVersion,
  };
}

test('uninitialized and zero requests return explicit sentinel reasons', async () => {
  const gate = await setup();
  assert.deepEqual(decision(await gate.readOne('evaluate', [1n])), {
    allowed: false, reason: 1n, headroom: 0n, proposed: 0n, stateVersion: 0n, policyVersion: 1n,
  });
  await gate.write('submitSourceTransaction', verifierArgs(opening));
  assert.deepEqual(decision(await gate.readOne('evaluate', [0n])), {
    allowed: false, reason: 2n, headroom: 10_000_000n, proposed: 50_000_000n, stateVersion: 1n, policyVersion: 1n,
  });
});

test('evaluate rejects debt50 plus 30 and allows debt30 plus 30 exactly', async () => {
  const gate = await setup();
  await gate.write('submitSourceTransaction', verifierArgs(opening));
  let result = decision(await gate.readOne('evaluate', [30_000_000n]));
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 3n);
  assert.equal(result.headroom, 10_000_000n);
  assert.equal(result.proposed, 80_000_000n);

  await gate.write('submitSourceTransaction', verifierArgs(repayment));
  result = decision(await gate.readOne('evaluate', [30_000_000n]));
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 0n);
  assert.equal(result.headroom, 30_000_000n);
  assert.equal(result.proposed, 60_000_000n);
  assert.equal((await gate.readOne('evaluate', [30_000_001n])).allowed, false);
  assert.equal((await gate.readOne('evaluate', [1n])).allowed, true);
});

test('only owner can set a positive policy and lowering it never changes debt', async () => {
  const gate = await setup();
  await gate.write('submitSourceTransaction', verifierArgs(opening));
  await gate.write('submitSourceTransaction', verifierArgs(repayment));
  await assert.rejects(() => gate.write('setPolicy', [20_000_000n], { caller: outsider }), /NotPolicyOwner/);
  await assert.rejects(() => gate.write('setPolicy', [0n], { caller: owner }), /ZeroCreditLimit/);
  await gate.write('setPolicy', [20_000_000n], { caller: owner });
  assert.equal(await gate.readOne('creditLimit'), 20_000_000n);
  assert.equal(await gate.readOne('policyVersion'), 2n);
  assert.equal(await gate.readOne('verifiedDebt'), 30_000_000n);
  const result = decision(await gate.readOne('evaluate', [1n]));
  assert.equal(result.headroom, 0n);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 3n);
});
