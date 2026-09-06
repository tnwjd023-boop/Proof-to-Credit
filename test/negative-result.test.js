'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyNegativeEvidence } = require('../src/negative-result');

function validEvidence() {
  return {
    sourceChainId: '11155111',
    destinationChainId: '102031',
    callMode: 'eth_call',
    proofs: [
      {
        kind: 'debt-opened',
        chainKey: '1',
        headerNumber: '11643709',
        sourceBlockNumber: '11643709',
        txIndex: '80',
        derivedIndex: '80',
        normal: { verdict: true },
        rootTampered: { verdict: false },
        bytesTampered: { verdict: false },
        continuityTampered: { verdict: false },
      },
      {
        kind: 'debt-repaid',
        chainKey: '1',
        headerNumber: '11643980',
        sourceBlockNumber: '11643980',
        txIndex: '77',
        derivedIndex: '77',
        normal: { verdict: true },
        rootTampered: { verdict: false },
        bytesTampered: { verdict: false },
        continuityTampered: { verdict: false },
      },
    ],
    replay: { rejected: true, errorName: 'AlreadyProcessed' },
    stateBeforeHash: '0x1111',
    stateAfterHash: '0x1111',
  };
}

test('classifies only complete runtime tamper rejection with replay and unchanged state as VERIFIED', () => {
  assert.equal(classifyNegativeEvidence(validEvidence()), 'VERIFIED');
});

test('blocks wrong networks, non-call execution, position mismatch, or an incomplete proof set', () => {
  const mutations = [
    (e) => { e.sourceChainId = '1'; },
    (e) => { e.destinationChainId = '1'; },
    (e) => { e.callMode = 'transaction'; },
    (e) => { e.proofs[0].chainKey = '2'; },
    (e) => { e.proofs[0].headerNumber = '9'; },
    (e) => { e.proofs[0].derivedIndex = '79'; },
    (e) => { e.proofs.pop(); },
  ];
  for (const mutate of mutations) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.equal(classifyNegativeEvidence(evidence), 'BLOCKED');
  }
});

test('blocks failed normal verification or any accepted tampered proof', () => {
  const mutations = [
    (e) => { e.proofs[0].normal.verdict = false; },
    (e) => { e.proofs[0].rootTampered.verdict = true; },
    (e) => { e.proofs[0].bytesTampered.verdict = true; },
    (e) => { e.proofs[0].continuityTampered.verdict = true; },
  ];
  for (const mutate of mutations) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.equal(classifyNegativeEvidence(evidence), 'BLOCKED');
  }
});

test('blocks missing replay rejection, wrong replay reason, or changed application state', () => {
  const mutations = [
    (e) => { e.replay.rejected = false; },
    (e) => { e.replay.errorName = 'InvalidProof'; },
    (e) => { e.stateAfterHash = '0x2222'; },
  ];
  for (const mutate of mutations) {
    const evidence = validEvidence();
    mutate(evidence);
    assert.equal(classifyNegativeEvidence(evidence), 'BLOCKED');
  }
});
