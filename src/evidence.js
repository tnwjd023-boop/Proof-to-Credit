'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getAddress, keccak256 } = require('ethers');

function nextRunStep({ manifest, slot, proofs }) {
  if (manifest.pending) {
    return { step: 'recover-pending', status: 'PENDING', kind: manifest.pending.kind, transactionHash: manifest.pending.transactionHash };
  }
  const destination = manifest[slot];
  if (destination?.pending) {
    return {
      step: 'recover-pending',
      status: 'PENDING',
      kind: destination.pending.kind,
      transactionHash: destination.pending.transactionHash,
    };
  }
  if (!manifest.source?.contractAddress) return { step: 'source-deploy', status: 'INCOMPLETE' };
  if (!manifest.opening?.transactionHash) return { step: 'source-open', status: 'INCOMPLETE' };
  if (!manifest.repayment?.transactionHash) return { step: 'source-repay', status: 'INCOMPLETE' };
  if (!proofs?.['debt-opened']) return { step: 'proof-open', status: 'INCOMPLETE' };
  if (!proofs?.['debt-repaid']) return { step: 'proof-repay', status: 'INCOMPLETE' };
  if (!destination?.gate?.address) return { step: 'destination-deploy', status: 'INCOMPLETE' };
  if (!destination.submissions?.['debt-opened']) return { step: 'submit-open', status: 'INCOMPLETE' };
  if (!destination.submissions?.['debt-repaid']) return { step: 'submit-repay', status: 'INCOMPLETE' };
  if (!destination.demo?.commitTransactionHash) return { step: 'commit-demo', status: 'INCOMPLETE' };
  return { step: 'complete', status: 'COMPLETE' };
}

function proofUseStatus(destination, proofKind) {
  if (destination?.pending && destination.pending.kind !== proofKind) {
    throw new Error('a different pending transaction must be recovered first');
  }
  if (destination?.pending?.kind === proofKind) return 'RECOVER_PENDING';
  if (destination?.submissions?.[proofKind]) return 'ALREADY_SUBMITTED';
  return 'AVAILABLE';
}

function classifyPendingReceipt(receipt, expected) {
  if (!receipt) return 'PENDING';
  if (String(receipt.hash).toLowerCase() !== String(expected.transactionHash).toLowerCase()) {
    throw new Error('pending receipt hash mismatch');
  }
  if (expected.to === null) {
    if (receipt.to !== null) throw new Error('pending receipt target mismatch');
  } else if (!receipt.to || getAddress(receipt.to) !== getAddress(expected.to)) {
    throw new Error('pending receipt target mismatch');
  }
  return Number(receipt.status) === 1 ? 'CONFIRMED' : 'REVERTED';
}

function deriveExpectedSubmission(manifest, proofKind, proof) {
  const opening = manifest.opening;
  if (!opening) throw new Error('opening record is required');
  const source = proofKind === 'debt-opened' ? opening : manifest.repayment;
  if (!source) throw new Error(`${proofKind} source record is required`);
  return {
    principal: BigInt(opening.principal),
    repaid: proofKind === 'debt-opened' ? 0n : BigInt(source.cumulativeRepaid),
    debt: BigInt(source.outstanding),
    sequence: BigInt(source.sequence),
    sourceBlock: BigInt(proof.headerNumber),
    txIndex: BigInt(proof.txIndex),
    stateVersion: BigInt(source.sequence),
  };
}

function recordPending(manifest, slot, pending) {
  const updated = structuredClone(manifest);
  const container = slot === null ? updated : updated[slot];
  if (!container) throw new Error('pending evidence container does not exist');
  if (container.pending) throw new Error('pending transaction already exists');
  container.pending = structuredClone(pending);
  return updated;
}

function clearPending(manifest, slot, kind, transactionHash) {
  const updated = structuredClone(manifest);
  const container = slot === null ? updated : updated[slot];
  if (container?.pending?.kind !== kind) throw new Error('pending kind mismatch');
  if (container.pending.transactionHash.toLowerCase() !== transactionHash.toLowerCase()) throw new Error('pending transaction hash mismatch');
  delete container.pending;
  return updated;
}

function finalizePending(manifest, slot, kind, record) {
  const updated = structuredClone(manifest);
  const destination = updated[slot];
  if (destination?.pending?.kind !== kind) throw new Error('pending kind mismatch');
  const recordHash = kind === 'commit-credit' ? record.commitTransactionHash : record.transactionHash;
  if (!recordHash || recordHash.toLowerCase() !== destination.pending.transactionHash.toLowerCase()) {
    throw new Error('pending transaction hash mismatch');
  }
  if (kind === 'commit-credit') {
    destination.demo = structuredClone(record);
  } else if (['debt-opened', 'debt-repaid'].includes(kind)) {
    destination.submissions ||= {};
    destination.submissions[kind] = structuredClone(record);
  } else {
    throw new Error('unsupported pending kind');
  }
  delete destination.pending;
  return updated;
}

function validatePendingTransaction(transaction, pending) {
  if (!transaction || transaction.hash.toLowerCase() !== pending.transactionHash.toLowerCase()) throw new Error('pending transaction hash mismatch');
  if (!transaction.from || getAddress(transaction.from) !== getAddress(pending.from)) throw new Error('pending transaction sender mismatch');
  if (BigInt(transaction.chainId) !== BigInt(pending.chainId)) throw new Error('pending transaction chain mismatch');
  if (pending.to === null) {
    if (transaction.to !== null) throw new Error('pending transaction target mismatch');
  } else if (!transaction.to || getAddress(transaction.to) !== getAddress(pending.to)) {
    throw new Error('pending transaction target mismatch');
  }
  if (keccak256(transaction.data) !== pending.dataHash) throw new Error('pending transaction calldata mismatch');
  if (BigInt(transaction.value) !== 0n) throw new Error('pending transaction must have zero value');
  if (BigInt(transaction.value) !== BigInt(pending.value)) throw new Error('pending transaction value mismatch');
  return true;
}

function proofEvidenceMatches(evidence, sourceRecord) {
  return Boolean(
    evidence?.classification === 'VERIFIED' &&
    evidence.bundle &&
    sourceRecord?.transactionHash &&
    typeof evidence.sourceTransactionHash === 'string' &&
    evidence.sourceTransactionHash.toLowerCase() === sourceRecord.transactionHash.toLowerCase()
  );
}

function recordedTransactionHash(manifest, slot, kind) {
  const destination = manifest[slot];
  const records = {
    'source-deploy': manifest.source?.deploymentTransactionHash,
    'source-open': manifest.opening?.transactionHash,
    'source-repay': manifest.repayment?.transactionHash,
    'decoder-deploy': destination?.decoder?.deploymentTransactionHash,
    'gate-deploy': destination?.gate?.deploymentTransactionHash,
    'debt-opened': destination?.submissions?.['debt-opened']?.transactionHash,
    'debt-repaid': destination?.submissions?.['debt-repaid']?.transactionHash,
    'commit-credit': destination?.demo?.commitTransactionHash,
  };
  return records[kind] || null;
}

function assertPublicEvidence(value) {
  const visit = (node) => {
    if (typeof node === 'string') {
      if (/(?:PRIVATE_KEY|API_KEY|PASSWORD|MNEMONIC|SEED_PHRASE)\s*[=:]/i.test(node) || /https?:\/\/[^/@:\s]+:[^/@\s]+@/i.test(node)) {
        throw new Error('secret value is not allowed in public evidence');
      }
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (/^(?:privatekey(?:hex)?|mnemonic|secret|walletsecret|seedphrase|password|passphrase|apikey|apitoken|accesstoken|authtoken|authorization|clientsecret|rpcpassword)$/.test(normalized)) {
        throw new Error(`secret field is not allowed in public evidence: ${key}`);
      }
      visit(child);
    }
  };
  visit(value);
  return value;
}

function json(value) {
  return `${JSON.stringify(value, (_, child) => typeof child === 'bigint' ? child.toString() : child, 2)}\n`;
}

function writeJsonAtomic(target, value) {
  assertPublicEvidence(value);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, json(value), { flag: 'wx' });
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function writeJsonExclusive(target, value) {
  assertPublicEvidence(value);
  try {
    fs.writeFileSync(target, json(value), { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`evidence already exists: ${target}`);
    throw error;
  }
}

module.exports = {
  assertPublicEvidence,
  classifyPendingReceipt,
  clearPending,
  deriveExpectedSubmission,
  finalizePending,
  nextRunStep,
  proofEvidenceMatches,
  proofUseStatus,
  recordPending,
  recordedTransactionHash,
  validatePendingTransaction,
  writeJsonAtomic,
  writeJsonExclusive,
};
