'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVmHarness } = require('./helpers/vm');
const { verifierArgs } = require('../src/proof-client');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'manifest.json')));
const proof = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'proofs', 'debt-opened.json'))).bundle;
const owner = '0x3000000000000000000000000000000000000003';

async function setup({ verdict = true, emitter = manifest.source.contractAddress } = {}) {
  const harness = await createVmHarness({ caller: owner });
  const verifier = await harness.deploy('TestOnlyVerifierMock', [verdict]);
  const decoder = await harness.deploy('EvmV1Decoder', []);
  const gate = await harness.deploy('VerifiedDebtGate', [
    verifier.address,
    decoder.address,
    1n,
    11155111n,
    emitter,
    manifest.source.assetId,
    manifest.opening.loanId,
    manifest.source.unitId,
    manifest.source.borrower,
    owner,
    60_000_000n,
  ]);
  return { gate };
}

function state(decoded) {
  return {
    initialized: decoded.initialized_,
    principal: decoded.principalOpened_,
    repaid: decoded.totalRepaid_,
    debt: decoded.verifiedDebt_,
    sequence: decoded.lastSequence_,
    sourceBlock: decoded.lastSourceBlock_,
    txIndex: decoded.lastTxIndex_,
    stateVersion: decoded.stateVersion_,
  };
}

test('actual DebtOpened proof bytes initialize the fixed loan state once', async () => {
  const { gate } = await setup();
  assert.deepEqual(state(await gate.read('getState')), {
    initialized: false,
    principal: 0n,
    repaid: 0n,
    debt: 0n,
    sequence: 0n,
    sourceBlock: 0n,
    txIndex: 0n,
    stateVersion: 0n,
  });
  const applied = await gate.write('submitSourceTransaction', verifierArgs(proof));
  assert.equal(applied.result[0], 1n);
  assert.equal(applied.events[0].name, 'SourceEventApplied');
  assert.deepEqual(state(await gate.read('getState')), {
    initialized: true,
    principal: 50_000_000n,
    repaid: 0n,
    debt: 50_000_000n,
    sequence: 1n,
    sourceBlock: 11_643_709n,
    txIndex: 80n,
    stateVersion: 1n,
  });
  await assert.rejects(() => gate.write('submitSourceTransaction', verifierArgs(proof)), /AlreadyProcessed/);
});

test('rejects wrong chain, failed verifier, and non-allowlisted emitter without state', async () => {
  const good = await setup();
  const wrongChain = verifierArgs(proof);
  wrongChain[0] = 2n;
  await assert.rejects(() => good.gate.write('submitSourceTransaction', wrongChain), /WrongSourceChain/);

  const failed = await setup({ verdict: false });
  await assert.rejects(() => failed.gate.write('submitSourceTransaction', verifierArgs(proof)), /InvalidProof/);

  const wrongEmitter = await setup({ emitter: '0x4000000000000000000000000000000000000004' });
  await assert.rejects(() => wrongEmitter.gate.write('submitSourceTransaction', verifierArgs(proof)), /NoApplicableLog/);
  assert.equal((await wrongEmitter.gate.read('getState')).initialized_, false);
});
