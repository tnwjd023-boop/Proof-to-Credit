'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyProbe } = require('../src/probe-result');

const valid = {
  normalVerdict: true,
  rootTamperedVerdict: false,
  continuityTamperedVerdict: false,
  derivedIndex: 3n,
  proofIndex: 3,
  proofHeight: 100,
  sourceHeight: 100,
  proofChainKey: 1,
  expectedChainKey: 1n,
};

test('classifies only a fully consistent runtime probe as VERIFIED', () => {
  assert.equal(classifyProbe(valid), 'VERIFIED');
});

test('blocks a proof whose derived transaction index does not match', () => {
  assert.equal(classifyProbe({ ...valid, derivedIndex: 2n }), 'BLOCKED');
});

test('blocks a proof whose chain or height does not match the source transaction', () => {
  assert.equal(classifyProbe({ ...valid, proofChainKey: 3 }), 'BLOCKED');
  assert.equal(classifyProbe({ ...valid, proofHeight: 99 }), 'BLOCKED');
});
