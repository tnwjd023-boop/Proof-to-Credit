'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Contract, JsonRpcProvider, Wallet, parseUnits } = require('ethers');
const { SOURCE_CHAIN_ID, openingRecord } = require('../src/source-run');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  require('dotenv').config({ quiet: true });
  if (process.argv[2] !== 'open' || option('--amount') !== '50') {
    throw new Error('Usage: node scripts/source-actions.js open --amount 50 --run <runId>');
  }
  const id = option('--run');
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('A safe --run value is required');
  const manifestPath = path.join(__dirname, '..', 'runs', id, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.opening) throw new Error('This run already contains a DebtOpened transaction');
  const artifacts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts.json'), 'utf8'));
  const artifact = artifacts.contracts.SingleDrawLoanMock;
  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== SOURCE_CHAIN_ID) throw new Error(`Refusing non-Sepolia chainId ${network.chainId}`);
    const signer = new Wallet(process.env.PRIVATE_KEY, provider);
    if (signer.address !== manifest.source.borrower) throw new Error('Signer is not the recorded borrower');
    const contract = new Contract(manifest.source.contractAddress, artifact.abi, signer);
    const transaction = await contract.openDebt(parseUnits('50', 6));
    const receipt = await transaction.wait();
    manifest.opening = openingRecord({
      receipt,
      contractAddress: manifest.source.contractAddress,
      borrower: signer.address,
      iface: contract.interface,
    });
    const state = await contract.getLoanState();
    if (!state.opened_ || state.principalOpened_ !== parseUnits('50', 6) || state.outstanding_ !== parseUnits('50', 6) || state.sequence_ !== 1n) {
      throw new Error('on-chain source state does not match open50');
    }
    manifest.opening.confirmedState = {
      opened: state.opened_,
      principalOpened: state.principalOpened_.toString(),
      totalRepaid: state.totalRepaid_.toString(),
      outstanding: state.outstanding_.toString(),
      sequence: state.sequence_.toString(),
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(manifest.opening, null, 2));
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(`SOURCE_ACTION_FAILED: ${error.message}`);
  process.exitCode = 1;
});
