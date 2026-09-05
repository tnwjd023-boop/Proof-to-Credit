'use strict';

function walletEnv(wallet) {
  return [
    '# TESTNET-ONLY wallet. Never fund with real assets.',
    'CC3_RPC_URL=https://rpc.cc3-testnet.creditcoin.network',
    'SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com',
    'PROOF_API_URL=https://proof-gen-api.cc3-testnet.creditcoin.network/api/v1',
    `WALLET_ADDRESS=${wallet.address}`,
    `PRIVATE_KEY=${wallet.privateKey}`,
    '',
  ].join('\n');
}

function publicWalletSummary(wallet) {
  return JSON.stringify({
    classification: 'TESTNET_ONLY',
    address: wallet.address,
    warning: 'Do not send mainnet tokens or real assets to this address.',
  });
}

module.exports = { publicWalletSummary, walletEnv };
