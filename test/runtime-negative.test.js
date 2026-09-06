'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTamperedProofs, contractErrorName, evidenceClock } = require('../src/runtime-negative');

const hash = (byte) => `0x${byte.repeat(64)}`;

function proof() {
  return {
    chainKey: '1',
    headerNumber: '10',
    txIndex: '2',
    txBytes: '0x0102ff',
    merkleProof: { root: hash('a'), siblings: [{ hash: hash('b'), isLeft: false }] },
    continuityProof: { lowerEndpointDigest: hash('c'), roots: [hash('d')] },
  };
}

test('builds independent root, bytes, and continuity mutations without changing the original proof', () => {
  const original = proof();
  const mutations = buildTamperedProofs(original);
  assert.deepEqual(original, proof());
  assert.equal(mutations.rootTampered.merkleProof.root, hash('1'));
  assert.equal(mutations.rootTampered.txBytes, original.txBytes);
  assert.notEqual(mutations.bytesTampered.txBytes, original.txBytes);
  assert.equal(mutations.bytesTampered.txBytes.length, original.txBytes.length);
  assert.equal(mutations.bytesTampered.merkleProof.root, original.merkleProof.root);
  assert.equal(mutations.continuityTampered.continuityProof.lowerEndpointDigest, hash('2'));
  assert.equal(mutations.continuityTampered.txBytes, original.txBytes);
});

test('extracts a contract error name only from structured or decodable revert data', () => {
  const fakeInterface = { parseError: (data) => data === '0x1234' ? { name: 'AlreadyProcessed' } : null };
  assert.equal(contractErrorName({ revert: { name: 'AlreadyProcessed' } }, fakeInterface), 'AlreadyProcessed');
  assert.equal(contractErrorName({ data: '0x1234' }, fakeInterface), 'AlreadyProcessed');
  assert.equal(contractErrorName(new Error('ambiguous text'), fakeInterface), null);
});

test('captures evidence start before completion using an injected clock', () => {
  const values = ['2026-09-06T06:00:00.000Z', '2026-09-06T06:00:03.000Z'];
  const clock = evidenceClock(() => values.shift());
  assert.equal(clock.startedAt, '2026-09-06T06:00:00.000Z');
  assert.equal(clock.completedAt(), '2026-09-06T06:00:03.000Z');
});
