'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchProof, normalizeProof, resumableProof, selectProofTarget, verifierArgs } = require('../src/proof-client');

const hash = (byte) => `0x${byte.repeat(64)}`;
const txHash = hash('a');
const valid = {
  chainKey: 1,
  headerNumber: 11643709,
  txIndex: 7,
  txBytes: '0x02abcd',
  cached: false,
  merkleProof: { root: hash('1'), siblings: [{ hash: hash('2'), isLeft: true }] },
  continuityProof: { lowerEndpointDigest: hash('3'), roots: [hash('4')] },
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('normalizes proof integers to lossless decimal strings and flattens verifier args', () => {
  const proof = normalizeProof(valid, { chainKey: 1n, headerNumber: 11643709n });
  assert.equal(proof.chainKey, '1');
  assert.equal(proof.headerNumber, '11643709');
  assert.equal(proof.txIndex, '7');
  assert.deepEqual(verifierArgs(proof), [
    1n,
    11643709n,
    '0x02abcd',
    [hash('1'), [[hash('2'), true]]],
    [hash('3'), [hash('4')]],
  ]);
});

test('rejects malformed proof schema and mismatched source position', () => {
  assert.throws(() => normalizeProof({ ...valid, txBytes: 'not-hex' }, { chainKey: 1n }), /txBytes/);
  assert.throws(() => normalizeProof(valid, { chainKey: 2n }), /chainKey/);
  assert.throws(() => normalizeProof(valid, { chainKey: 1n, headerNumber: 9n }), /headerNumber/);
});

test('polls retriable responses at 15 seconds and returns once attested', async () => {
  const waits = [];
  const replies = [
    response(404, { retriable: true, message: 'reorg window' }),
    response(503, { retriable: true, message: 'upstream unavailable' }),
    response(200, valid),
  ];
  const proof = await fetchProof({
    baseUrl: 'https://proof.example/api/v1',
    chainKey: 1n,
    txHash,
    headerNumber: 11643709n,
    fetchImpl: async () => replies.shift(),
    sleep: async (milliseconds) => waits.push(milliseconds),
    now: (() => { let value = 0; return () => (value += 1000); })(),
  });
  assert.deepEqual(waits, [15000, 15000]);
  assert.equal(proof.headerNumber, '11643709');
});

test('stops after the 30 minute attestation timeout', async () => {
  await assert.rejects(
    () => fetchProof({
      baseUrl: 'https://proof.example/api/v1',
      chainKey: 1n,
      txHash,
      fetchImpl: async () => response(404, { retriable: true }),
      sleep: async () => {},
      now: (() => { let value = 0; return () => (value += 900001); })(),
    }),
    /30 minute timeout/,
  );
});

test('selects the opening or repayment manifest record by transaction hash', () => {
  const opening = { transactionHash: hash('b'), blockNumber: 10 };
  const repayment = { transactionHash: hash('c'), blockNumber: 20 };
  assert.deepEqual(selectProofTarget({ opening, repayment }, repayment.transactionHash), {
    kind: 'debt-repaid',
    record: repayment,
  });
  assert.throws(() => selectProofTarget({ opening, repayment }, hash('d')), /does not match/);
});

test('refresh bypasses a saved proof whose continuity path may have expired', () => {
  assert.equal(resumableProof(valid, { chainKey: 1n }, true), null);
  assert.equal(resumableProof(valid, { chainKey: 1n }, false).chainKey, '1');
});
