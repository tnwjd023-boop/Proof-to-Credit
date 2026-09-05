'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Wallet } = require('ethers');
const { publicWalletSummary, walletEnv } = require('../src/wallet-env');

async function main() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    throw new Error('.env already exists; refusing to overwrite an existing wallet or configuration');
  }
  const wallet = Wallet.createRandom();
  const handle = fs.openSync(envPath, 'wx', 0o600);
  try {
    fs.writeFileSync(handle, walletEnv(wallet), { encoding: 'utf8' });
  } finally {
    fs.closeSync(handle);
  }
  console.log(publicWalletSummary(wallet));
}

main().catch((error) => {
  console.error(`WALLET_CREATION_FAILED: ${error.message}`);
  process.exitCode = 1;
});
