'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts.json');

test('compiler artifact fixes viaIR, Paris, optimizer 200, decoder and test-only mock', () => {
  const artifacts = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  assert.equal(artifacts.settings.viaIR, true);
  assert.equal(artifacts.settings.evmVersion, 'paris');
  assert.deepEqual(artifacts.settings.optimizer, { enabled: true, runs: 200 });
  assert.equal(artifacts.contracts.EvmV1Decoder.sourceName, 'contracts/vendor/EvmV1Decoder.sol');
  assert.equal(artifacts.contracts.TestOnlyVerifierMock.sourceName, 'test/helpers/proof-mocks.sol');
});
