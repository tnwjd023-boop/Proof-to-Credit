'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Contract, JsonRpcProvider, Wallet, parseUnits } = require('ethers');
const { SOURCE_CHAIN_ID, openingRecord, repaymentRecord } = require('../src/source-run');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  require('dotenv').config({ quiet: true });
  const action = process.argv[2];
  const expectedAmount = action === 'open' ? '50' : action === 'repay' ? '20' : undefined;
  if (!expectedAmount || option('--amount') !== expectedAmount) throw new Error('Usage: source-actions.js <open --amount 50|repay --amount 20> --run <runId>');
  const id = option('--run');
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('A safe --run value is required');
  const manifestPath = path.join(__dirname, '..', 'runs', id, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (action === 'open' && manifest.opening) throw new Error('This run already contains a DebtOpened transaction');
  if (action === 'repay' && (!manifest.opening || manifest.repayment)) throw new Error('Repayment requires one opening and no prior repayment');
  const artifacts = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'artifacts', 'contracts.json'), 'utf8'));
  const artifact = artifacts.contracts.SingleDrawLoanMock;
  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== SOURCE_CHAIN_ID) throw new Error(`Refusing non-Sepolia chainId ${network.chainId}`);
    const signer = new Wallet(process.env.PRIVATE_KEY, provider);
    if (signer.address !== manifest.source.borrower) throw new Error('Signer is not the recorded borrower');
    const contract = new Contract(manifest.source.contractAddress, artifact.abi, signer);
    const transaction = action === 'open'
      ? await contract.openDebt(parseUnits('50', 6))
      : await contract.repayDebt(parseUnits('20', 6));
    const receipt = await transaction.wait();
    if (action === 'open') {
      manifest.opening = openingRecord({ receipt, contractAddress: manifest.source.contractAddress, borrower: signer.address, iface: contract.interface });
    } else {
      manifest.repayment = repaymentRecord({ receipt, contractAddress: manifest.source.contractAddress, borrower: signer.address, loanId: manifest.opening.loanId, iface: contract.interface });
    }
    const state = await contract.getLoanState();
    const expectedRepaid = action === 'open' ? 0n : parseUnits('20', 6);
    const expectedOutstanding = action === 'open' ? parseUnits('50', 6) : parseUnits('30', 6);
    const expectedSequence = action === 'open' ? 1n : 2n;
    if (!state.opened_ || state.principalOpened_ !== parseUnits('50', 6) || state.totalRepaid_ !== expectedRepaid || state.outstanding_ !== expectedOutstanding || state.sequence_ !== expectedSequence) {
      throw new Error(`on-chain source state does not match ${action}`);
    }
    const record = action === 'open' ? manifest.opening : manifest.repayment;
    record.confirmedState = {
      opened: state.opened_,
      principalOpened: state.principalOpened_.toString(),
      totalRepaid: state.totalRepaid_.toString(),
      outstanding: state.outstanding_.toString(),
      sequence: state.sequence_.toString(),
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify(record, null, 2));
  } finally {
    provider.destroy();
  }
}

main().catch((error) => {
  console.error(`SOURCE_ACTION_FAILED: ${error.message}`);
  process.exitCode = 1;
});
