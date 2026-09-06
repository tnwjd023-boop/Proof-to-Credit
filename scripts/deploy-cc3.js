'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractFactory, JsonRpcProvider, Wallet, keccak256 } = require('ethers');
const { compileContracts } = require('./compile');
const { networkConfig } = require('../src/config');
const { destinationConstructorArgs } = require('../src/cc3-run');
const {
  classifyPendingReceipt,
  clearPending,
  recordPending,
  validatePendingTransaction,
  writeJsonAtomic,
} = require('../src/evidence');

function runId() {
  const index = process.argv.indexOf('--run');
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Usage: node scripts/deploy-cc3.js --run <runId>');
  return value;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  require('dotenv').config({ quiet: true });
  const id = runId();
  const slot = option('--slot') || 'destination';
  if (!/^destination[A-Za-z0-9]*$/.test(slot)) throw new Error('Invalid destination --slot');
  const manifestPath = path.join(__dirname, '..', 'runs', id, 'manifest.json');
  let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest[slot]?.gate?.address) {
    console.log(JSON.stringify({ status: 'COMPLETE', destination: manifest[slot] }, null, 2));
    return;
  }
  if (manifest[slot]?.pending && !['decoder-deploy', 'gate-deploy'].includes(manifest[slot].pending.kind)) {
    throw new Error('a non-deployment destination transaction must be recovered first');
  }

  const provider = new JsonRpcProvider(networkConfig.destination.rpcUrl);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== networkConfig.destination.evmChainId) throw new Error(`Refusing non-CC3 chainId ${network.chainId}`);
    const artifacts = compileContracts().contracts;
    manifest[slot] ||= {
      network: 'Creditcoin CC3 Testnet',
      chainId: network.chainId.toString(),
      verifier: networkConfig.destination.blockProver,
      initialCreditLimit: '60000000',
    };

    if (manifest[slot].pending) {
      const pending = manifest[slot].pending;
      const transaction = await provider.getTransaction(pending.transactionHash);
      validatePendingTransaction(transaction, pending);
      const receipt = await provider.getTransactionReceipt(pending.transactionHash);
      const status = classifyPendingReceipt(receipt, pending);
      if (status === 'PENDING') throw new Error(`${pending.kind} is still pending; no replacement was sent`);
      if (status === 'REVERTED') throw new Error(`${pending.kind} reverted; pending evidence was retained`);
      if (!receipt.contractAddress) throw new Error(`${pending.kind} receipt has no contract address`);
      const code = await provider.getCode(receipt.contractAddress);
      if (code === '0x') throw new Error(`${pending.kind} has no runtime code`);
      const record = {
        address: receipt.contractAddress,
        deploymentTransactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        codeHash: keccak256(code),
        codeBytes: (code.length - 2) / 2,
      };
      if (pending.kind === 'decoder-deploy') manifest[slot].decoder = record;
      else manifest[slot].gate = record;
      manifest = clearPending(manifest, slot, pending.kind, receipt.hash);
      writeJsonAtomic(manifestPath, manifest);
      console.log(JSON.stringify({ status: 'RECOVERED', recoveredKind: pending.kind, destination: manifest[slot] }, null, 2));
      return;
    }

    const signer = new Wallet(process.env.PRIVATE_KEY, provider);
    if (signer.address !== manifest.source.borrower) throw new Error('signer does not match run borrower');
    if (!manifest[slot].decoder?.address) {
      const decoder = await new ContractFactory(artifacts.EvmV1Decoder.abi, artifacts.EvmV1Decoder.bytecode, signer).deploy();
      const transaction = decoder.deploymentTransaction();
      manifest = recordPending(manifest, slot, {
        kind: 'decoder-deploy', transactionHash: transaction.hash, from: transaction.from, to: null,
        chainId: transaction.chainId.toString(), dataHash: keccak256(transaction.data), value: transaction.value.toString(), sentAt: new Date().toISOString(),
      });
      writeJsonAtomic(manifestPath, manifest);
      const receipt = await transaction.wait();
      const status = classifyPendingReceipt(receipt, manifest[slot].pending);
      if (status !== 'CONFIRMED') throw new Error(`decoder deployment ${status.toLowerCase()}; pending evidence was retained`);
      const code = await provider.getCode(receipt.contractAddress);
      if (code === '0x') throw new Error('decoder deployment has no runtime code');
      manifest[slot].decoder = {
        address: receipt.contractAddress, deploymentTransactionHash: receipt.hash, blockNumber: receipt.blockNumber,
        codeHash: keccak256(code), codeBytes: (code.length - 2) / 2,
      };
      manifest = clearPending(manifest, slot, 'decoder-deploy', receipt.hash);
      writeJsonAtomic(manifestPath, manifest);
    }

    const gateArgs = destinationConstructorArgs({ manifest, verifier: networkConfig.destination.blockProver, decoder: manifest[slot].decoder.address });
    const gate = await new ContractFactory(artifacts.VerifiedDebtGate.abi, artifacts.VerifiedDebtGate.bytecode, signer).deploy(...gateArgs);
    const transaction = gate.deploymentTransaction();
    manifest = recordPending(manifest, slot, {
      kind: 'gate-deploy', transactionHash: transaction.hash, from: transaction.from, to: null,
      chainId: transaction.chainId.toString(), dataHash: keccak256(transaction.data), value: transaction.value.toString(), sentAt: new Date().toISOString(),
    });
    writeJsonAtomic(manifestPath, manifest);
    const receipt = await transaction.wait();
    const status = classifyPendingReceipt(receipt, manifest[slot].pending);
    if (status !== 'CONFIRMED') throw new Error(`gate deployment ${status.toLowerCase()}; pending evidence was retained`);
    const code = await provider.getCode(receipt.contractAddress);
    if (code === '0x') throw new Error('gate deployment has no runtime code');
    manifest[slot].gate = {
      address: receipt.contractAddress, deploymentTransactionHash: receipt.hash, blockNumber: receipt.blockNumber,
      codeHash: keccak256(code), codeBytes: (code.length - 2) / 2,
    };
    manifest = clearPending(manifest, slot, 'gate-deploy', receipt.hash);
    writeJsonAtomic(manifestPath, manifest);
    console.log(JSON.stringify({ status: 'CONFIRMED', destination: manifest[slot] }, null, 2));
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(`CC3_DEPLOY_FAILED: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
