'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Contract, ContractFactory, FetchRequest, Interface, JsonRpcProvider, getAddress, keccak256 } = require('ethers');
const { networkConfig } = require('../src/config');
const { nextRunStep, proofEvidenceMatches, recordPending, recordedTransactionHash, validatePendingTransaction, writeJsonAtomic, writeJsonExclusive } = require('../src/evidence');
const { normalizeProof, verifierArgs } = require('../src/proof-client');
const { destinationConstructorArgs } = require('../src/cc3-run');
const { SOURCE_ASSET_ID, SOURCE_UNIT_ID } = require('../src/source-run');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function provider(url) {
  const request = new FetchRequest(url);
  request.timeout = 15_000;
  return new JsonRpcProvider(request);
}

async function main() {
  const id = option('--run');
  const slot = option('--slot') || 'destinationT12';
  const suppliedTx = option('--tx');
  const suppliedKind = option('--kind');
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || !/^destination[A-Za-z0-9]*$/.test(slot)) {
    throw new Error('Usage: node scripts/resume.js --run <runId> [--slot destinationT12] [--tx 0x... --kind <step-kind>]');
  }
  if (Boolean(suppliedTx) !== Boolean(suppliedKind)) throw new Error('--tx and --kind must be supplied together');
  const recoveryKinds = ['source-deploy', 'source-open', 'source-repay', 'decoder-deploy', 'gate-deploy', 'debt-opened', 'debt-repaid', 'commit-credit'];
  if (suppliedTx && (!/^0x[0-9a-fA-F]{64}$/.test(suppliedTx) || !recoveryKinds.includes(suppliedKind))) {
    throw new Error('invalid recovery transaction or kind');
  }

  const root = path.join(__dirname, '..');
  const runDirectory = path.join(root, 'runs', id);
  const manifestPath = path.join(runDirectory, 'manifest.json');
  const manifestExists = fs.existsSync(manifestPath);
  if (!manifestExists && suppliedKind !== 'source-deploy') throw new Error('run manifest does not exist');
  let manifest = manifestExists
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { runId: id, createdAt: new Date().toISOString() };
  if (suppliedTx && recordedTransactionHash(manifest, slot, suppliedKind)) {
    throw new Error('selected operation is already finalized; no recovery record was added');
  }
  const proofEvidence = {};
  const proofs = {};
  for (const kind of ['debt-opened', 'debt-repaid']) {
    const proofPath = path.join(runDirectory, 'proofs', `${kind}.json`);
    try { proofEvidence[kind] = JSON.parse(fs.readFileSync(proofPath, 'utf8')); } catch { proofEvidence[kind] = null; }
    const sourceRecord = kind === 'debt-opened' ? manifest.opening : manifest.repayment;
    proofs[kind] = proofEvidenceMatches(proofEvidence[kind], sourceRecord);
    if (proofs[kind]) {
      try {
        const normalized = normalizeProof(proofEvidence[kind].bundle, {
          chainKey: networkConfig.source.attestcoinChainKey,
          headerNumber: sourceRecord.blockNumber,
        });
        proofs[kind] = BigInt(normalized.txIndex) === BigInt(proofEvidence[kind].sourceTransactionIndex);
      } catch {
        proofs[kind] = false;
      }
    }
  }

  const source = provider(networkConfig.source.rpcUrl);
  const cc3 = provider(networkConfig.destination.rpcUrl);
  try {
    const [sourceNetwork, destinationNetwork] = await Promise.all([source.getNetwork(), cc3.getNetwork()]);
    if (sourceNetwork.chainId !== networkConfig.source.evmChainId || destinationNetwork.chainId !== networkConfig.destination.evmChainId) {
      throw new Error('refusing unexpected source or destination network');
    }

    if (suppliedTx) {
      const isSource = suppliedKind.startsWith('source-');
      const rpc = isSource ? source : cc3;
      const transaction = await rpc.getTransaction(suppliedTx);
      if (!transaction) throw new Error('recovery transaction is not known to the selected RPC');
      const artifacts = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'contracts.json'))).contracts;
      let expectedData;
      let expectedTo;
      if (suppliedKind === 'source-deploy') {
        expectedTo = null;
        expectedData = (await new ContractFactory(artifacts.SingleDrawLoanMock.abi, artifacts.SingleDrawLoanMock.bytecode)
          .getDeployTransaction(SOURCE_ASSET_ID, SOURCE_UNIT_ID, transaction.from)).data;
      } else if (suppliedKind === 'source-open' || suppliedKind === 'source-repay') {
        if (!manifest.source?.contractAddress) throw new Error('source contract is not recorded');
        expectedTo = manifest.source.contractAddress;
        const iface = new Interface(artifacts.SingleDrawLoanMock.abi);
        expectedData = iface.encodeFunctionData(suppliedKind === 'source-open' ? 'openDebt' : 'repayDebt', [suppliedKind === 'source-open' ? 50_000_000n : 20_000_000n]);
      } else if (suppliedKind === 'decoder-deploy') {
        expectedTo = null;
        expectedData = (await new ContractFactory(artifacts.EvmV1Decoder.abi, artifacts.EvmV1Decoder.bytecode).getDeployTransaction()).data;
      } else if (suppliedKind === 'gate-deploy') {
        if (!manifest[slot]?.decoder?.address) throw new Error('decoder deployment is not recorded');
        expectedTo = null;
        const args = destinationConstructorArgs({ manifest, verifier: networkConfig.destination.blockProver, decoder: manifest[slot].decoder.address });
        expectedData = (await new ContractFactory(artifacts.VerifiedDebtGate.abi, artifacts.VerifiedDebtGate.bytecode).getDeployTransaction(...args)).data;
      } else {
        const destination = manifest[slot];
        if (!destination?.gate?.address) throw new Error('destination gate is not deployed');
        expectedTo = destination.gate.address;
        const iface = new Interface(artifacts.VerifiedDebtGate.abi);
        const parsed = iface.parseTransaction({ data: transaction.data, value: transaction.value });
        if (!parsed || parsed.name !== (suppliedKind === 'commit-credit' ? 'commitCredit' : 'submitSourceTransaction')) {
          throw new Error('recovery transaction method does not match its kind');
        }
        if (suppliedKind !== 'commit-credit') {
          const sourceRecord = suppliedKind === 'debt-opened' ? manifest.opening : manifest.repayment;
          const proof = normalizeProof(proofEvidence[suppliedKind]?.bundle, {
            chainKey: networkConfig.source.attestcoinChainKey,
            headerNumber: sourceRecord.blockNumber,
          });
          expectedData = iface.encodeFunctionData('submitSourceTransaction', verifierArgs(proof));
        } else {
          if (parsed.args[0] !== 30_000_000n || parsed.args[1] !== BigInt(destination.submissions?.['debt-repaid']?.stateVersion || -1) || parsed.args[2] <= 0n) {
            throw new Error('recovery commitment arguments do not match the demo state');
          }
          expectedData = transaction.data;
        }
      }
      if (keccak256(transaction.data) !== keccak256(expectedData)) throw new Error('recovery transaction arguments do not match the selected step');
      if (suppliedKind !== 'source-deploy' && getAddress(transaction.from) !== getAddress(manifest.source.borrower)) {
        throw new Error('recovery transaction sender does not match the run borrower');
      }
      const pending = {
        kind: suppliedKind, transactionHash: suppliedTx, from: transaction.from, to: expectedTo,
        chainId: transaction.chainId.toString(), dataHash: keccak256(transaction.data), value: transaction.value.toString(), recoveredAt: new Date().toISOString(),
      };
      validatePendingTransaction(transaction, pending);
      const receipt = await rpc.getTransactionReceipt(suppliedTx);
      if (receipt && Number(receipt.status) !== 1) throw new Error('recovery transaction reverted and cannot be finalized');
      const containerSlot = isSource ? null : slot;
      if (!isSource && !manifest[slot]) {
        manifest[slot] = { network: 'Creditcoin CC3 Testnet', chainId: destinationNetwork.chainId.toString(), verifier: networkConfig.destination.blockProver, initialCreditLimit: '60000000' };
      }
      const container = containerSlot === null ? manifest : manifest[containerSlot];
      if (container.pending) {
        if (container.pending.kind !== suppliedKind || container.pending.transactionHash.toLowerCase() !== suppliedTx.toLowerCase()) {
          throw new Error('supplied transaction conflicts with existing pending evidence');
        }
      } else {
        manifest = recordPending(manifest, containerSlot, pending);
        fs.mkdirSync(runDirectory, { recursive: true });
        if (manifestExists) writeJsonAtomic(manifestPath, manifest);
        else writeJsonExclusive(manifestPath, manifest);
      }
      validatePendingTransaction(transaction, (containerSlot === null ? manifest : manifest[containerSlot]).pending);
    }

    const plan = nextRunStep({ manifest, slot, proofs });
    const commands = {
      'source-deploy': `node scripts/deploy-source.js --run ${id}`,
      'source-open': `node scripts/source-actions.js open --run ${id} --amount 50`,
      'source-repay': `node scripts/source-actions.js repay --run ${id} --amount 20`,
      'proof-open': `node scripts/fetch-proof.js --run ${id} --tx ${manifest.opening?.transactionHash || '<openingTxHash>'}`,
      'proof-repay': `node scripts/fetch-proof.js --run ${id} --tx ${manifest.repayment?.transactionHash || '<repaymentTxHash>'}`,
      'destination-deploy': `node scripts/deploy-cc3.js --run ${id} --slot ${slot}`,
      'submit-open': `node scripts/submit-proof.js --run ${id} --slot ${slot} --proof debt-opened`,
      'submit-repay': `node scripts/submit-proof.js --run ${id} --slot ${slot} --proof debt-repaid`,
      'commit-demo': `node scripts/demo.js --run ${id} --slot ${slot} --mode testnet`,
    };
    if (plan.step === 'recover-pending') {
      const recoveryCommands = {
        'source-deploy': `node scripts/deploy-source.js --run ${id}`,
        'source-open': `node scripts/source-actions.js open --run ${id} --amount 50`,
        'source-repay': `node scripts/source-actions.js repay --run ${id} --amount 20`,
        'decoder-deploy': `node scripts/deploy-cc3.js --run ${id} --slot ${slot}`,
        'gate-deploy': `node scripts/deploy-cc3.js --run ${id} --slot ${slot}`,
        'debt-opened': `node scripts/submit-proof.js --run ${id} --slot ${slot} --proof debt-opened`,
        'debt-repaid': `node scripts/submit-proof.js --run ${id} --slot ${slot} --proof debt-repaid`,
        'commit-credit': `node scripts/demo.js --run ${id} --slot ${slot} --mode testnet`,
      };
      commands['recover-pending'] = recoveryCommands[plan.kind];
    }

    let audit = null;
    if (plan.status === 'COMPLETE') {
      const destination = manifest[slot];
      const checks = [
        [source, manifest.source.deploymentTransactionHash, null, manifest.source.contractAddress, 'source deployment'],
        [source, manifest.opening.transactionHash, manifest.source.contractAddress, null, 'source opening'],
        [source, manifest.repayment.transactionHash, manifest.source.contractAddress, null, 'source repayment'],
        [cc3, destination.decoder.deploymentTransactionHash, null, destination.decoder.address, 'decoder deployment'],
        [cc3, destination.gate.deploymentTransactionHash, null, destination.gate.address, 'gate deployment'],
        [cc3, destination.submissions['debt-opened'].transactionHash, destination.gate.address, null, 'opening submission'],
        [cc3, destination.submissions['debt-repaid'].transactionHash, destination.gate.address, null, 'repayment submission'],
        [cc3, destination.demo.commitTransactionHash, destination.gate.address, null, 'credit commitment'],
      ];
      for (const [rpc, hash, expectedTo, expectedCreated, label] of checks) {
        const receipt = await rpc.getTransactionReceipt(hash);
        if (!receipt || Number(receipt.status) !== 1) throw new Error(`${label} receipt is absent or failed`);
        if (expectedTo && (!receipt.to || getAddress(receipt.to) !== getAddress(expectedTo))) throw new Error(`${label} target mismatch`);
        if (expectedCreated && (!receipt.contractAddress || getAddress(receipt.contractAddress) !== getAddress(expectedCreated))) throw new Error(`${label} created-address mismatch`);
      }
      const artifact = JSON.parse(fs.readFileSync(path.join(root, 'artifacts', 'contracts.json'))).contracts.VerifiedDebtGate;
      const gate = new Contract(destination.gate.address, artifact.abi, cc3);
      const [state, committedCredit, sourceCode, decoderCode, gateCode] = await Promise.all([
        gate.getState(),
        gate.committedCredit(),
        source.getCode(manifest.source.contractAddress),
        cc3.getCode(destination.decoder.address),
        cc3.getCode(destination.gate.address),
      ]);
      if (!state.initialized_ || state.verifiedDebt_ !== BigInt(manifest.repayment.outstanding)) throw new Error('latest verified debt does not match manifest');
      if (committedCredit !== BigInt(destination.demo.committedCredit)) throw new Error('latest committed credit does not match manifest');
      if (sourceCode === '0x' || decoderCode === '0x' || gateCode === '0x') throw new Error('expected deployed code is absent');
      if (keccak256(sourceCode) !== manifest.source.deployedCodeHash || keccak256(decoderCode) !== destination.decoder.codeHash || keccak256(gateCode) !== destination.gate.codeHash) {
        throw new Error('deployed code hash does not match manifest evidence');
      }
      audit = {
        classification: 'VERIFIED',
        receipts: checks.length,
        verifiedDebt: state.verifiedDebt_.toString(),
        committedCredit: committedCredit.toString(),
      };
    }

    console.log(JSON.stringify({ runId: id, slot, ...plan, nextCommand: commands[plan.step] || null, audit }, null, 2));
  } finally {
    source.destroy();
    cc3.destroy();
  }
}

main().catch((error) => {
  console.error(`RESUME_BLOCKED: ${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
