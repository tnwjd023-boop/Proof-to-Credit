'use strict';

require('dotenv').config({ quiet: true });

const networkConfig = Object.freeze({
  source: Object.freeze({
    name: 'Ethereum Sepolia',
    evmChainId: 11155111n,
    attestcoinChainKey: 1n,
    rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    blockTimeSeconds: 12,
  }),
  destination: Object.freeze({
    name: 'Creditcoin CC3 Testnet',
    evmChainId: 102031n,
    rpcUrl: process.env.CC3_RPC_URL || 'https://rpc.cc3-testnet.creditcoin.network',
    blockProver: '0x0000000000000000000000000000000000000FD2',
    chainInfo: '0x0000000000000000000000000000000000000FD3',
  }),
  proofApiUrl:
    process.env.PROOF_API_URL || 'https://proof-gen-api.cc3-testnet.creditcoin.network/api/v1',
  writesEnabled: false,
});

function assertTestnetOnly(config = networkConfig) {
  if (config.source.evmChainId !== 11155111n || config.source.attestcoinChainKey !== 1n) {
    throw new Error('Only Sepolia (EVM chainId 11155111, Attestcoin chainKey 1) is allowed');
  }
  if (config.destination.evmChainId !== 102031n) {
    throw new Error('Only Creditcoin CC3 Testnet (EVM chainId 102031) is allowed');
  }
  if (config.writesEnabled) throw new Error('T01-T02 must remain read-only');
}

module.exports = { networkConfig, assertTestnetOnly };
