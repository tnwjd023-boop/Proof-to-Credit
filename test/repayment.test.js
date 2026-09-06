'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AbiCoder } = require('ethers');
const { createVmHarness } = require('./helpers/vm');
const { verifierArgs } = require('../src/proof-client');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'manifest.json')));
const opening = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'proofs', 'debt-opened.json'))).bundle;
const repayment = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'proofs', 'debt-repaid.json'))).bundle;
const owner = '0x3000000000000000000000000000000000000003';
const coder = AbiCoder.defaultAbiCoder();

async function setup() {
  const harness = await createVmHarness({ caller: owner });
  const verifier = await harness.deploy('TestOnlyVerifierMock', [true]);
  const decoder = await harness.deploy('EvmV1Decoder', []);
  return harness.deploy('VerifiedDebtGate', [
    verifier.address, decoder.address, 1n, 11155111n, manifest.source.contractAddress,
    manifest.source.assetId, manifest.opening.loanId, manifest.source.unitId,
    manifest.source.borrower, owner, 60_000_000n,
  ]);
}

function mutateRepaymentData(proof, values) {
  const copy = structuredClone(proof);
  const [type, chunks] = coder.decode(['uint8', 'bytes[]'], copy.txBytes);
  const mutableChunks = [...chunks];
  const receiptIndex = Number(type) <= 2 ? 2 : 3;
  const [status, gas, logs, bloom] = coder.decode(
    ['uint8', 'uint64', 'tuple(address address_,bytes32[] topics,bytes data)[]', 'bytes'],
    mutableChunks[receiptIndex],
  );
  const mutableLogs = logs.map((log) => ({ address_: log.address_, topics: [...log.topics], data: log.data }));
  const target = mutableLogs.findIndex((log) => log.address_.toLowerCase() === manifest.source.contractAddress.toLowerCase());
  const current = coder.decode(['bytes32', 'uint64', 'uint256', 'uint256', 'uint256', 'uint64'], mutableLogs[target].data);
  mutableLogs[target].data = coder.encode(
    ['bytes32', 'uint64', 'uint256', 'uint256', 'uint256', 'uint64'],
    values(current),
  );
  mutableChunks[receiptIndex] = coder.encode(
    ['uint8', 'uint64', 'tuple(address address_,bytes32[] topics,bytes data)[]', 'bytes'],
    [status, gas, mutableLogs, bloom],
  );
  copy.txBytes = coder.encode(['uint8', 'bytes[]'], [type, mutableChunks]);
  return copy;
}

test('actual opening then repay20 proof reconstructs debt from 50 to 30', async () => {
  const gate = await setup();
  await gate.write('submitSourceTransaction', verifierArgs(opening));
  const applied = await gate.write('submitSourceTransaction', verifierArgs(repayment));
  assert.equal(applied.result[0], 1n);
  const state = await gate.read('getState');
  assert.equal(state.principalOpened_, 50_000_000n);
  assert.equal(state.totalRepaid_, 20_000_000n);
  assert.equal(state.verifiedDebt_, 30_000_000n);
  assert.equal(state.lastSequence_, 2n);
  assert.equal(state.lastSourceBlock_, 11_643_980n);
  assert.equal(state.lastTxIndex_, 77n);
  assert.equal(state.stateVersion_, 2n);
});

test('rejects repayment before opening and sequence gaps without processed residue', async () => {
  const gate = await setup();
  await assert.rejects(() => gate.write('submitSourceTransaction', verifierArgs(repayment)), /MissingOpening/);
  await gate.write('submitSourceTransaction', verifierArgs(opening));
  const gap = mutateRepaymentData(repayment, (v) => [v[0], 3n, v[2], v[3], v[4], v[5]]);
  await assert.rejects(() => gate.write('submitSourceTransaction', verifierArgs(gap)), /InvalidSequence/);
  assert.equal(await gate.readOne('stateVersion'), 1n);
});

test('rejects wrong unit, amount, cumulative, and outstanding relationships', async () => {
  const mutations = [
    (v) => [`0x${'11'.repeat(32)}`, v[1], v[2], v[3], v[4], v[5]],
    (v) => [v[0], v[1], 0n, v[3], v[4], v[5]],
    (v) => [v[0], v[1], v[2], 19_000_000n, v[4], v[5]],
    (v) => [v[0], v[1], v[2], v[3], 31_000_000n, v[5]],
  ];
  for (const mutation of mutations) {
    const gate = await setup();
    await gate.write('submitSourceTransaction', verifierArgs(opening));
    await assert.rejects(() => gate.write('submitSourceTransaction', verifierArgs(mutateRepaymentData(repayment, mutation))), /InvalidRepayment/);
    assert.equal(await gate.readOne('verifiedDebt'), 50_000_000n);
  }
});
