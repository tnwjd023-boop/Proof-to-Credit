'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractFactory, JsonRpcProvider, Wallet, keccak256 } = require('ethers');
const { compileContracts } = require('./compile');
const { SOURCE_ASSET_ID, SOURCE_CHAIN_ID, SOURCE_UNIT_ID, deploymentRecord } = require('../src/source-run');
const {
  classifyPendingReceipt,
  clearPending,
  recordPending,
  validatePendingTransaction,
  writeJsonAtomic,
  writeJsonExclusive,
} = require('../src/evidence');

function runId() {
  const index = process.argv.indexOf('--run');
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Usage: node scripts/deploy-source.js --run <runId>');
  return value;
}

async function main() {
  require('dotenv').config({ quiet: true });
  const id = runId();
  const directory = path.join(__dirname, '..', 'runs', id);
  const manifestPath = path.join(directory, 'manifest.json');
  let manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
  if (manifest?.source?.contractAddress) {
    console.log(JSON.stringify({ status: 'COMPLETE', source: manifest.source }, null, 2));
    return;
  }
  if (manifest && manifest.pending?.kind !== 'source-deploy') throw new Error('existing incomplete manifest is not a source deployment journal');

  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== SOURCE_CHAIN_ID) throw new Error(`Refusing non-Sepolia chainId ${network.chainId}`);
    const artifact = compileContracts().contracts.SingleDrawLoanMock;
    let transaction;
    let receipt;
    if (manifest?.pending) {
      transaction = await provider.getTransaction(manifest.pending.transactionHash);
      validatePendingTransaction(transaction, manifest.pending);
      receipt = await provider.getTransactionReceipt(manifest.pending.transactionHash);
    } else {
      const signer = new Wallet(process.env.PRIVATE_KEY, provider);
      if (signer.address !== process.env.WALLET_ADDRESS) throw new Error('WALLET_ADDRESS does not match PRIVATE_KEY');
      const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(
        SOURCE_ASSET_ID,
        SOURCE_UNIT_ID,
        signer.address,
      );
      transaction = contract.deploymentTransaction();
      manifest = recordPending({ runId: id, createdAt: new Date().toISOString() }, null, {
        kind: 'source-deploy',
        transactionHash: transaction.hash,
        from: transaction.from,
        to: null,
        chainId: transaction.chainId.toString(),
        dataHash: keccak256(transaction.data),
        value: transaction.value.toString(),
        sentAt: new Date().toISOString(),
      });
      fs.mkdirSync(directory, { recursive: true });
      writeJsonExclusive(manifestPath, manifest);
      receipt = await transaction.wait();
    }
    const status = classifyPendingReceipt(receipt, manifest.pending);
    if (status === 'PENDING') throw new Error('source deployment is still pending; no replacement was sent');
    if (status === 'REVERTED') throw new Error('source deployment reverted; pending evidence was retained');
    if (!receipt.contractAddress) throw new Error('source deployment receipt has no contract address');
    const code = await provider.getCode(receipt.contractAddress);
    manifest.source = deploymentRecord({
      chainId: network.chainId,
      address: receipt.contractAddress,
      txHash: receipt.hash,
      code,
      expectedCode: artifact.deployedBytecode,
      borrower: transaction.from,
    });
    manifest = clearPending(manifest, null, 'source-deploy', receipt.hash);
    writeJsonAtomic(manifestPath, manifest);
    console.log(JSON.stringify({ status: 'CONFIRMED', source: manifest.source }, null, 2));
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(`SOURCE_DEPLOY_FAILED: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
