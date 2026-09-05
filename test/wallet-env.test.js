'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { walletEnv, publicWalletSummary } = require('../src/wallet-env');

test('wallet env contains the testnet key while public summary never does', () => {
  const wallet = {
    address: '0x1000000000000000000000000000000000000001',
    privateKey: `0x${'11'.repeat(32)}`,
  };
  const env = walletEnv(wallet);
  const summary = publicWalletSummary(wallet);
  assert.match(env, /PRIVATE_KEY=0x11/);
  assert.match(env, /WALLET_ADDRESS=0x1000/);
  assert.doesNotMatch(summary, /0x11{10}/);
  assert.match(summary, /0x1000000000000000000000000000000000000001/);
});
