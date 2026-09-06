'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../src/evidence');

const hash = (byte) => `0x${byte.repeat(64)}`;

function manifest() {
  return {
    runId: 'resume-test',
    source: { contractAddress: '0x1000000000000000000000000000000000000001' },
    opening: { transactionHash: hash('a'), blockNumber: 101, sequence: '1', principal: '700', outstanding: '700' },
    repayment: { transactionHash: hash('b'), blockNumber: 202, sequence: '2', amount: '250', cumulativeRepaid: '250', outstanding: '450' },
    destinationR: { gate: { address: '0x2000000000000000000000000000000000000002' }, submissions: {} },
  };
}

const proofs = { 'debt-opened': true, 'debt-repaid': true };

test('plans the first incomplete step and reports a complete run without replay', () => {
  const base = manifest();
  assert.deepEqual(nextRunStep({ manifest: {}, slot: 'destinationR', proofs: {} }), { step: 'source-deploy', status: 'INCOMPLETE' });
  assert.equal(nextRunStep({ manifest: { source: base.source }, slot: 'destinationR', proofs: {} }).step, 'source-open');
  assert.equal(nextRunStep({ manifest: { source: base.source, opening: base.opening }, slot: 'destinationR', proofs: {} }).step, 'source-repay');
  assert.equal(nextRunStep({ manifest: base, slot: 'destinationR', proofs: {} }).step, 'proof-open');
  assert.equal(nextRunStep({ manifest: base, slot: 'destinationR', proofs: { 'debt-opened': true } }).step, 'proof-repay');
  const submittedOpening = structuredClone(base);
  submittedOpening.destinationR.submissions['debt-opened'] = { transactionHash: hash('c') };
  assert.equal(nextRunStep({ manifest: submittedOpening, slot: 'destinationR', proofs }).step, 'submit-repay');
  submittedOpening.destinationR.submissions['debt-repaid'] = { transactionHash: hash('d') };
  assert.equal(nextRunStep({ manifest: submittedOpening, slot: 'destinationR', proofs }).step, 'commit-demo');
  submittedOpening.destinationR.demo = { commitTransactionHash: hash('e') };
  assert.deepEqual(nextRunStep({ manifest: submittedOpening, slot: 'destinationR', proofs }), { step: 'complete', status: 'COMPLETE' });
});

test('pending transaction always becomes the next recovery step', () => {
  const value = manifest();
  value.destinationR.pending = { kind: 'debt-opened', transactionHash: hash('c') };
  assert.deepEqual(nextRunStep({ manifest: value, slot: 'destinationR', proofs }), {
    step: 'recover-pending', status: 'PENDING', kind: 'debt-opened', transactionHash: hash('c'),
  });
  const sourcePending = { runId: 'x', pending: { kind: 'source-deploy', transactionHash: hash('a') } };
  assert.equal(nextRunStep({ manifest: sourcePending, slot: 'destinationR', proofs: {} }).kind, 'source-deploy');
  const deployPending = manifest();
  deployPending.destinationR = { pending: { kind: 'decoder-deploy', transactionHash: hash('b') } };
  assert.equal(nextRunStep({ manifest: deployPending, slot: 'destinationR', proofs: {} }).kind, 'decoder-deploy');
});

test('saved proof is reusable for a new destination but never replayed in the same destination', () => {
  const value = manifest();
  assert.equal(proofUseStatus(value.destinationR, 'debt-opened'), 'AVAILABLE');
  value.destinationR.submissions['debt-opened'] = { transactionHash: hash('c') };
  assert.equal(proofUseStatus(value.destinationR, 'debt-opened'), 'ALREADY_SUBMITTED');
  value.destinationR.pending = { kind: 'debt-repaid', transactionHash: hash('d') };
  assert.equal(proofUseStatus(value.destinationR, 'debt-repaid'), 'RECOVER_PENDING');
  assert.throws(() => proofUseStatus(value.destinationR, 'debt-opened'), /different pending transaction/);
  assert.equal(proofUseStatus({ gate: { address: '0x3000000000000000000000000000000000000003' }, submissions: {} }, 'debt-opened'), 'AVAILABLE');
});

test('classifies missing, reverted, mismatched, and confirmed pending receipts', () => {
  const expected = { transactionHash: hash('a'), to: '0x2000000000000000000000000000000000000002' };
  assert.equal(classifyPendingReceipt(null, expected), 'PENDING');
  assert.equal(classifyPendingReceipt({ hash: hash('a'), to: expected.to, status: 0 }, expected), 'REVERTED');
  assert.throws(() => classifyPendingReceipt({ hash: hash('b'), to: expected.to, status: 1 }, expected), /hash mismatch/);
  assert.throws(() => classifyPendingReceipt({ hash: hash('a'), to: '0x3000000000000000000000000000000000000003', status: 1 }, expected), /target mismatch/);
  assert.equal(classifyPendingReceipt({ hash: hash('a'), to: expected.to, status: 1 }, expected), 'CONFIRMED');
  assert.equal(classifyPendingReceipt({ hash: hash('a'), to: null, status: 1 }, { transactionHash: hash('a'), to: null }), 'CONFIRMED');
});

test('derives opening and repayment expectations from manifest and proof positions', () => {
  const value = manifest();
  assert.deepEqual(deriveExpectedSubmission(value, 'debt-opened', { headerNumber: '101', txIndex: '9' }), {
    principal: 700n, repaid: 0n, debt: 700n, sequence: 1n, sourceBlock: 101n, txIndex: 9n, stateVersion: 1n,
  });
  assert.deepEqual(deriveExpectedSubmission(value, 'debt-repaid', { headerNumber: '202', txIndex: '11' }), {
    principal: 700n, repaid: 250n, debt: 450n, sequence: 2n, sourceBlock: 202n, txIndex: 11n, stateVersion: 2n,
  });
});

test('records one pending transaction without mutating or replacing existing manifest data', () => {
  const value = manifest();
  const updated = recordPending(value, 'destinationR', { kind: 'debt-opened', transactionHash: hash('c'), createdAt: '2026-09-06T00:00:00.000Z' });
  assert.equal(value.destinationR.pending, undefined);
  assert.equal(updated.opening.transactionHash, hash('a'));
  assert.equal(updated.destinationR.pending.transactionHash, hash('c'));
  assert.throws(() => recordPending(updated, 'destinationR', { kind: 'debt-repaid', transactionHash: hash('d') }), /pending transaction already exists/);
  const rootPending = recordPending({ runId: 'new' }, null, { kind: 'source-deploy', transactionHash: hash('e') });
  assert.equal(rootPending.pending.kind, 'source-deploy');
  const cleared = clearPending(rootPending, null, 'source-deploy', hash('e'));
  assert.equal(cleared.pending, undefined);
  assert.throws(() => clearPending(rootPending, null, 'source-open', hash('e')), /pending kind mismatch/);
});

test('finds finalized transaction hashes for every resumable operation', () => {
  const value = manifest();
  value.source.deploymentTransactionHash = hash('1');
  value.destinationR.decoder = { deploymentTransactionHash: hash('2') };
  value.destinationR.gate.deploymentTransactionHash = hash('3');
  value.destinationR.submissions['debt-opened'] = { transactionHash: hash('4') };
  value.destinationR.demo = { commitTransactionHash: hash('5') };
  assert.equal(recordedTransactionHash(value, 'destinationR', 'source-deploy'), hash('1'));
  assert.equal(recordedTransactionHash(value, 'destinationR', 'source-open'), hash('a'));
  assert.equal(recordedTransactionHash(value, 'destinationR', 'source-repay'), hash('b'));
  assert.equal(recordedTransactionHash(value, 'destinationR', 'decoder-deploy'), hash('2'));
  assert.equal(recordedTransactionHash(value, 'destinationR', 'gate-deploy'), hash('3'));
  assert.equal(recordedTransactionHash(value, 'destinationR', 'debt-opened'), hash('4'));
  assert.equal(recordedTransactionHash(value, 'destinationR', 'commit-credit'), hash('5'));
  assert.equal(recordedTransactionHash(value, 'destinationR', 'debt-repaid'), null);
});

test('finalizes only the matching pending proof or demo transaction', () => {
  const value = manifest();
  value.destinationR.pending = { kind: 'debt-opened', transactionHash: hash('c') };
  const proofRecord = { transactionHash: hash('c'), receiptStatus: 1 };
  const proofFinal = finalizePending(value, 'destinationR', 'debt-opened', proofRecord);
  assert.equal(value.destinationR.pending.kind, 'debt-opened');
  assert.equal(proofFinal.destinationR.pending, undefined);
  assert.deepEqual(proofFinal.destinationR.submissions['debt-opened'], proofRecord);

  const demoValue = structuredClone(proofFinal);
  demoValue.destinationR.pending = { kind: 'commit-credit', transactionHash: hash('d') };
  const demoRecord = { commitTransactionHash: hash('d'), receiptStatus: 1 };
  const demoFinal = finalizePending(demoValue, 'destinationR', 'commit-credit', demoRecord);
  assert.equal(demoFinal.destinationR.pending, undefined);
  assert.deepEqual(demoFinal.destinationR.demo, demoRecord);

  assert.throws(() => finalizePending(demoValue, 'destinationR', 'debt-repaid', {}), /pending kind mismatch/);
  assert.throws(() => finalizePending(value, 'destinationR', 'debt-opened', { transactionHash: hash('d') }), /transaction hash mismatch/);
});

test('binds a recovered transaction to hash, sender, chain, target, calldata, and zero value', () => {
  const transaction = {
    hash: hash('a'),
    from: '0x1000000000000000000000000000000000000001',
    to: '0x2000000000000000000000000000000000000002',
    chainId: 102031n,
    data: '0x1234',
    value: 0n,
  };
  const pending = {
    transactionHash: transaction.hash,
    from: transaction.from,
    to: transaction.to,
    chainId: transaction.chainId.toString(),
    dataHash: require('ethers').keccak256(transaction.data),
    value: '0',
  };
  assert.equal(validatePendingTransaction(transaction, pending), true);
  for (const change of [
    { hash: hash('b') },
    { from: '0x3000000000000000000000000000000000000003' },
    { to: '0x3000000000000000000000000000000000000003' },
    { chainId: 1n },
    { data: '0xabcd' },
    { value: 1n },
  ]) assert.throws(() => validatePendingTransaction({ ...transaction, ...change }, pending), /pending transaction/);
  assert.throws(() => validatePendingTransaction({ ...transaction, value: 1n }, { ...pending, value: '1' }), /zero value/);
});

test('treats only a verified proof for the exact manifest transaction as ready', () => {
  const source = manifest().opening;
  const evidence = { classification: 'VERIFIED', sourceTransactionHash: source.transactionHash, bundle: { chainKey: '1' } };
  assert.equal(proofEvidenceMatches(evidence, source), true);
  assert.equal(proofEvidenceMatches({ ...evidence, classification: 'BLOCKED' }, source), false);
  assert.equal(proofEvidenceMatches({ ...evidence, sourceTransactionHash: hash('f') }, source), false);
  assert.equal(proofEvidenceMatches(null, source), false);
});

test('atomic JSON writing preserves public data and rejects secret-bearing evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptc-resume-'));
  const target = path.join(directory, 'manifest.json');
  try {
    writeJsonAtomic(target, { runId: 'safe', nested: { transactionHash: hash('a') } });
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { runId: 'safe', nested: { transactionHash: hash('a') } });
    writeJsonAtomic(target, { runId: 'updated', nested: { transactionHash: hash('b') } });
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { runId: 'updated', nested: { transactionHash: hash('b') } });
    assert.throws(() => writeJsonExclusive(target, { runId: 'replacement' }), /already exists/);
    const newTarget = path.join(directory, 'new-manifest.json');
    writeJsonExclusive(newTarget, { runId: 'new' });
    assert.deepEqual(JSON.parse(fs.readFileSync(newTarget, 'utf8')), { runId: 'new' });
    const bigintTarget = path.join(directory, 'bigint.json');
    writeJsonExclusive(bigintTarget, { amount: 30n });
    assert.deepEqual(JSON.parse(fs.readFileSync(bigintTarget, 'utf8')), { amount: '30' });
    for (const unsafe of [
      { privateKey: hash('f') }, { 'private-key-hex': hash('f') }, { password: 'x' },
      { apiToken: 'x' }, { authorization: 'Bearer x' }, { rpcUrl: 'https://user:pass@example.test' },
    ]) assert.throws(() => assertPublicEvidence(unsafe), /secret|credential/i);
    assert.throws(() => writeJsonAtomic(target, { note: `PRIVATE_KEY=${hash('e')}` }), /secret value/i);
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { runId: 'updated', nested: { transactionHash: hash('b') } });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
