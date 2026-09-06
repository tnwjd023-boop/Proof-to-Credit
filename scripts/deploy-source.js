'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ContractFactory, JsonRpcProvider, Wallet } = require('ethers');
const { compileContracts } = require('./compile');
const { SOURCE_ASSET_ID, SOURCE_CHAIN_ID, SOURCE_UNIT_ID, deploymentRecord } = require('../src/source-run');

function runId() {
  const index = process.argv.indexOf('--run');
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Usage: node scripts/deploy-source.js --run <runId>');
  return value;
}

async function main() {
  require('dotenv').config({ quiet: true });
  const id = runId();
  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== SOURCE_CHAIN_ID) throw new Error(`Refusing non-Sepolia chainId ${network.chainId}`);
    const signer = new Wallet(process.env.PRIVATE_KEY, provider);
    if (signer.address !== process.env.WALLET_ADDRESS) throw new Error('WALLET_ADDRESS does not match PRIVATE_KEY');
    const artifact = compileContracts().contracts.SingleDrawLoanMock;
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(
      SOURCE_ASSET_ID,
      SOURCE_UNIT_ID,
      signer.address,
    );
    const deploymentTx = contract.deploymentTransaction();
    const receipt = await deploymentTx.wait();
    if (receipt.status !== 1) throw new Error('source deployment receipt failed');
    const address = await contract.getAddress();
    const code = await provider.getCode(address, receipt.blockNumber);
    const manifest = {
      runId: id,
      createdAt: new Date().toISOString(),
      source: deploymentRecord({
        chainId: network.chainId,
        address,
        txHash: deploymentTx.hash,
        code,
        expectedCode: artifact.deployedBytecode,
        borrower: signer.address,
      }),
    };
    const directory = path.join(__dirname, '..', 'runs', id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(manifest, null, 2));
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(`SOURCE_DEPLOY_FAILED: ${error.message}`);
  process.exitCode = 1;
});
