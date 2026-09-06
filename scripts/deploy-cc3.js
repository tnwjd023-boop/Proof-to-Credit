'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractFactory, JsonRpcProvider, Wallet, keccak256 } = require('ethers');
const { compileContracts } = require('./compile');
const { networkConfig } = require('../src/config');
const { destinationConstructorArgs } = require('../src/cc3-run');

function runId() {
  const index = process.argv.indexOf('--run');
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Usage: node scripts/deploy-cc3.js --run <runId>');
  return value;
}

async function deployChecked(factory, args, provider) {
  const contract = await factory.deploy(...args);
  const transaction = contract.deploymentTransaction();
  const receipt = await transaction.wait();
  if (receipt.status !== 1) throw new Error('CC3 deployment receipt failed');
  const address = await contract.getAddress();
  const code = await provider.getCode(address, receipt.blockNumber);
  if (code === '0x') throw new Error('CC3 deployment has no runtime code');
  return { contract, address, transactionHash: transaction.hash, blockNumber: receipt.blockNumber, codeHash: keccak256(code), codeBytes: (code.length - 2) / 2 };
}

async function main() {
  require('dotenv').config({ quiet: true });
  const id = runId();
  const manifestPath = path.join(__dirname, '..', 'runs', id, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.destination) throw new Error('destination already exists for this run');
  const provider = new JsonRpcProvider(networkConfig.destination.rpcUrl);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== 102031n) throw new Error(`Refusing non-CC3 chainId ${network.chainId}`);
    const signer = new Wallet(process.env.PRIVATE_KEY, provider);
    if (signer.address !== manifest.source.borrower) throw new Error('signer does not match run borrower');
    const artifacts = compileContracts().contracts;
    const decoder = await deployChecked(new ContractFactory(artifacts.EvmV1Decoder.abi, artifacts.EvmV1Decoder.bytecode, signer), [], provider);
    const gateArgs = destinationConstructorArgs({ manifest, verifier: networkConfig.destination.blockProver, decoder: decoder.address });
    const gate = await deployChecked(new ContractFactory(artifacts.VerifiedDebtGate.abi, artifacts.VerifiedDebtGate.bytecode, signer), gateArgs, provider);
    manifest.destination = {
      network: 'Creditcoin CC3 Testnet',
      chainId: network.chainId.toString(),
      verifier: networkConfig.destination.blockProver,
      decoder: { address: decoder.address, deploymentTransactionHash: decoder.transactionHash, blockNumber: decoder.blockNumber, codeHash: decoder.codeHash, codeBytes: decoder.codeBytes },
      gate: { address: gate.address, deploymentTransactionHash: gate.transactionHash, blockNumber: gate.blockNumber, codeHash: gate.codeHash, codeBytes: gate.codeBytes },
      initialCreditLimit: '60000000',
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(manifest.destination, null, 2));
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(`CC3_DEPLOY_FAILED: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
