'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AbiCoder, keccak256 } = require('ethers');
const { createVmHarness } = require('./helpers/vm');
const { verifierArgs } = require('../src/proof-client');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'manifest.json')));
const proof = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'proofs', 'debt-opened.json'))).bundle;
const owner = '0x3000000000000000000000000000000000000003';

async function gateFor(emitter = manifest.source.contractAddress) {
  const harness = await createVmHarness({ caller: owner });
  const verifier = await harness.deploy('TestOnlyVerifierMock', [true]);
  const decoder = await harness.deploy('EvmV1Decoder', []);
  const gate = await harness.deploy('VerifiedDebtGate', [
    verifier.address, decoder.address, 1n, 11155111n, emitter,
    manifest.source.assetId, manifest.opening.loanId, manifest.source.unitId,
    manifest.source.borrower, owner, 60_000_000n,
  ]);
  return { gate };
}

test('source position ordering is lexicographic across block, tx, and log indexes', async () => {
  const harness = await createVmHarness({ caller: owner });
  const position = await harness.deploy('TestOnlyPositionHarness', []);
  assert.equal(await position.readOne('isAfter', [11n, 0n, 0n, 10n, 99n, 99n]), true);
  assert.equal(await position.readOne('isAfter', [10n, 6n, 0n, 10n, 5n, 99n]), true);
  assert.equal(await position.readOne('isAfter', [10n, 5n, 8n, 10n, 5n, 7n]), true);
  assert.equal(await position.readOne('isAfter', [10n, 5n, 7n, 10n, 5n, 7n]), false);
  assert.equal(await position.readOne('isAfter', [10n, 4n, 99n, 10n, 5n, 7n]), false);
});

test('query and event identifiers bind verified tx index and receipt log index', async () => {
  const { gate } = await gateFor();
  const result = await gate.write('submitSourceTransaction', verifierArgs(proof));
  const queryId = keccak256(AbiCoder.defaultAbiCoder().encode(['uint64', 'uint64', 'uint64'], [1n, 11_643_709n, 80n]));
  const eventId = keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint64'], [queryId, 0n]));
  assert.equal(await gate.readOne('processedQueries', [queryId]), true);
  assert.equal(await gate.readOne('lastEventId'), eventId);
  assert.equal(result.events[0].args.queryId, queryId);
  assert.equal(result.events[0].args.eventId, eventId);
  await assert.rejects(() => gate.write('submitSourceTransaction', verifierArgs(proof)), /AlreadyProcessed/);
  assert.equal(await gate.readOne('stateVersion'), 1n);
});

test('failed batch leaves its query unprocessed so it can be retried later', async () => {
  const { gate } = await gateFor('0x4000000000000000000000000000000000000004');
  const queryId = keccak256(AbiCoder.defaultAbiCoder().encode(['uint64', 'uint64', 'uint64'], [1n, 11_643_709n, 80n]));
  await assert.rejects(() => gate.write('submitSourceTransaction', verifierArgs(proof)), /NoApplicableLog/);
  assert.equal(await gate.readOne('processedQueries', [queryId]), false);
  assert.equal(await gate.readOne('stateVersion'), 0n);
});
