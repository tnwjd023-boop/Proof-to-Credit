'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertHealthyProofApi } = require('../src/health');

test('accepts a healthy proof API with both upstream RPCs connected', () => {
  assert.doesNotThrow(() =>
    assertHealthyProofApi({ status: 'healthy', cc3_rpc_connected: true, eth_rpc_connected: true }),
  );
});

test('rejects a degraded proof API even when HTTP succeeded', () => {
  assert.throws(
    () => assertHealthyProofApi({ status: 'degraded', cc3_rpc_connected: false, eth_rpc_connected: true }),
    /degraded.*cc3_rpc_connected=false/,
  );
});
