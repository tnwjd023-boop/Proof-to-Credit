'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AbiCoder, keccak256 } = require('ethers');
const { createVmHarness } = require('./helpers/vm');
const { verifierArgs } = require('../src/proof-client');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'manifest.json')));
const opening = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'proofs', 'debt-opened.json'))).bundle;
const repayment = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'proofs', 'debt-repaid.json'))).bundle;
const borrower = manifest.source.borrower;
const owner = '0x3000000000000000000000000000000000000003';
const outsider = '0x4000000000000000000000000000000000000004';
const coder = AbiCoder.defaultAbiCoder();

async function setup() {
  const harness = await createVmHarness({ caller: owner });
  const verifier = await harness.deploy('TestOnlyVerifierMock', [true]);
  const decoder = await harness.deploy('EvmV1Decoder', []);
  const gate = await harness.deploy('VerifiedDebtGate', [
    verifier.address, decoder.address, 1n, 11155111n, manifest.source.contractAddress,
    manifest.source.assetId, manifest.opening.loanId, manifest.source.unitId,
    borrower, owner, 60_000_000n,
  ]);
  return { gate };
}

function decodeEnvelope(proof) {
  const copy = structuredClone(proof);
  const [type, chunks] = coder.decode(['uint8', 'bytes[]'], copy.txBytes);
  const mutableChunks = [...chunks];
  const receiptIndex = Number(type) <= 2 ? 2 : 3;
  const [status, gas, logs, bloom] = coder.decode(
    ['uint8', 'uint64', 'tuple(address address_,bytes32[] topics,bytes data)[]', 'bytes'],
    mutableChunks[receiptIndex],
  );
  const mutableLogs = logs.map((log) => ({ address_: log.address_, topics: [...log.topics], data: log.data }));
  return { copy, type, mutableChunks, receiptIndex, status, gas, logs: mutableLogs, bloom };
}

function mutateReceipt(proof, mutate) {
  const envelope = decodeEnvelope(proof);
  const changed = mutate(envelope) || envelope;
  changed.mutableChunks[changed.receiptIndex] = coder.encode(
    ['uint8', 'uint64', 'tuple(address address_,bytes32[] topics,bytes data)[]', 'bytes'],
    [changed.status, changed.gas, changed.logs, changed.bloom],
  );
  changed.copy.txBytes = coder.encode(['uint8', 'bytes[]'], [changed.type, changed.mutableChunks]);
  return changed.copy;
}

function matchingLog(envelope) {
  return envelope.logs.find((log) => log.address_.toLowerCase() === manifest.source.contractAddress.toLowerCase());
}

function mutateRepaymentData(proof, mutate) {
  return mutateReceipt(proof, (envelope) => {
    const log = matchingLog(envelope);
    const values = coder.decode(['bytes32', 'uint64', 'uint256', 'uint256', 'uint256', 'uint64'], log.data);
    log.data = coder.encode(
      ['bytes32', 'uint64', 'uint256', 'uint256', 'uint256', 'uint64'],
      mutate(values),
    );
    return envelope;
  });
}

function queryIdFor(proof, blockHeight = BigInt(proof.headerNumber)) {
  let txIndex = 0n;
  proof.merkleProof.siblings.slice(0, 64).forEach((node, index) => {
    if (node.isLeft) txIndex |= 1n << BigInt(index);
  });
  return keccak256(coder.encode(['uint64', 'uint64', 'uint64'], [BigInt(proof.chainKey), blockHeight, txIndex]));
}

async function snapshot(gate, queryId) {
  return {
    stateVersion: await gate.readOne('stateVersion'),
    verifiedDebt: await gate.readOne('verifiedDebt'),
    totalRepaid: await gate.readOne('totalRepaid'),
    processed: await gate.readOne('processedQueries', [queryId]),
  };
}

async function rejectsWithoutResidue(gate, proof, pattern, args = verifierArgs(proof)) {
  const queryId = queryIdFor(proof, args[1]);
  const before = await snapshot(gate, queryId);
  await assert.rejects(() => gate.write('submitSourceTransaction', args), pattern);
  assert.deepEqual(await snapshot(gate, queryId), before);
}

test('rejects failed receipt, unrelated emitter, wrong signature, and malformed matching ABI atomically', async () => {
  const cases = [
    {
      pattern: /InvalidProof/,
      proof: mutateReceipt(repayment, (e) => ({ ...e, status: 0n })),
    },
    {
      pattern: /NoApplicableLog/,
      proof: mutateReceipt(repayment, (e) => { matchingLog(e).address_ = outsider; return e; }),
    },
    {
      pattern: /NoApplicableLog/,
      proof: mutateReceipt(repayment, (e) => { matchingLog(e).topics[0] = `0x${'11'.repeat(32)}`; return e; }),
    },
    {
      pattern: /revert|invalid|exception/i,
      proof: mutateReceipt(repayment, (e) => { matchingLog(e).data = '0x12'; return e; }),
    },
  ];
  for (const item of cases) {
    const { gate } = await setup();
    await gate.write('submitSourceTransaction', verifierArgs(opening));
    await rejectsWithoutResidue(gate, item.proof, item.pattern);
  }
});

test('rejects wrong repayment asset, loan, borrower, and unit without residue', async () => {
  const topicMutations = [1, 2, 3].map((topic) => mutateReceipt(repayment, (e) => {
    matchingLog(e).topics[topic] = `0x${'22'.repeat(32)}`;
    return e;
  }));
  const wrongUnit = mutateRepaymentData(repayment, (v) => [`0x${'33'.repeat(32)}`, ...v.slice(1)]);
  for (const proof of [...topicMutations, wrongUnit]) {
    const { gate } = await setup();
    await gate.write('submitSourceTransaction', verifierArgs(opening));
    await rejectsWithoutResidue(gate, proof, /InvalidRepayment/);
  }
});

test('rejects every invalid repayment arithmetic relation and timestamp regression without residue', async () => {
  const mutations = [
    (v) => [v[0], v[1], 50_000_001n, v[3], v[4], v[5]],
    (v) => [v[0], v[1], v[2], 50_000_001n, v[4], v[5]],
    (v) => [v[0], v[1], v[2], v[3], 29_000_000n, v[5]],
    (v) => [v[0], v[1], v[2], v[3], v[4], BigInt(manifest.opening.sourceTimestamp) - 1n],
  ];
  for (const mutation of mutations) {
    const { gate } = await setup();
    await gate.write('submitSourceTransaction', verifierArgs(opening));
    const proof = mutateRepaymentData(repayment, mutation);
    await rejectsWithoutResidue(gate, proof, /InvalidRepayment/);
  }
});

test('full repayment is final and a later repayment cannot reduce debt below zero', async () => {
  const { gate } = await setup();
  await gate.write('submitSourceTransaction', verifierArgs(opening));
  const full = mutateRepaymentData(repayment, (v) => [v[0], 2n, 50_000_000n, 50_000_000n, 0n, v[5]]);
  await gate.write('submitSourceTransaction', verifierArgs(full));
  assert.equal(await gate.readOne('verifiedDebt'), 0n);
  const extra = mutateRepaymentData(repayment, (v) => [v[0], 3n, 1n, 50_000_001n, 0n, v[5] + 1n]);
  const args = verifierArgs(extra);
  args[1] += 1n;
  await rejectsWithoutResidue(gate, extra, /InvalidRepayment/, args);
});

test('a batch with duplicate matching repayment logs rolls back the first log too', async () => {
  const { gate } = await setup();
  await gate.write('submitSourceTransaction', verifierArgs(opening));
  const duplicate = mutateReceipt(repayment, (e) => { e.logs.push({ ...matchingLog(e), topics: [...matchingLog(e).topics] }); return e; });
  await rejectsWithoutResidue(gate, duplicate, /InvalidSequence/);
});

test('earlier source position and exact replay cannot change accepted state', async () => {
  const { gate } = await setup();
  await gate.write('submitSourceTransaction', verifierArgs(opening));
  await gate.write('submitSourceTransaction', verifierArgs(repayment));
  await rejectsWithoutResidue(gate, repayment, /AlreadyProcessed/);

  const older = mutateRepaymentData(repayment, (v) => [v[0], 3n, 1n, 21_000_000n, 29_000_000n, v[5] + 1n]);
  const args = verifierArgs(older);
  args[1] = BigInt(manifest.opening.blockNumber);
  await rejectsWithoutResidue(gate, older, /OutOfOrderSourcePosition/, args);
});

test('unauthorized policy and commitment failures leave policy and allocation unchanged', async () => {
  const { gate } = await setup();
  await gate.write('submitSourceTransaction', verifierArgs(opening));
  await gate.write('submitSourceTransaction', verifierArgs(repayment));
  const before = {
    limit: await gate.readOne('creditLimit'),
    policyVersion: await gate.readOne('policyVersion'),
    stateVersion: await gate.readOne('stateVersion'),
    committed: await gate.readOne('committedCredit'),
  };
  await assert.rejects(() => gate.write('setPolicy', [1n], { caller: outsider }), /NotPolicyOwner/);
  await assert.rejects(() => gate.write('commitCredit', [1n, 2n, 1n], { caller: outsider }), /NotBorrower/);
  assert.deepEqual({
    limit: await gate.readOne('creditLimit'),
    policyVersion: await gate.readOne('policyVersion'),
    stateVersion: await gate.readOne('stateVersion'),
    committed: await gate.readOne('committedCredit'),
  }, before);
});

test('extreme verified principal fails closed instead of allowing overflowed utilization', async () => {
  const { gate } = await setup();
  const hugeOpening = mutateReceipt(opening, (e) => {
    const log = matchingLog(e);
    const values = coder.decode(['bytes32', 'uint64', 'uint256', 'uint256', 'uint64'], log.data);
    const maximum = (1n << 256n) - 1n;
    log.data = coder.encode(['bytes32', 'uint64', 'uint256', 'uint256', 'uint64'], [values[0], 1n, maximum, maximum, values[4]]);
    return e;
  });
  await gate.write('submitSourceTransaction', verifierArgs(hugeOpening));
  await assert.rejects(() => gate.readOne('evaluate', [1n]), /Panic\(17\)|overflow|revert|exception/i);
  await assert.rejects(() => gate.write('commitCredit', [1n, 1n, 1n], { caller: borrower }), /CreditLimitExceeded/);
  assert.equal(await gate.readOne('committedCredit'), 0n);
  assert.equal(await gate.readOne('stateVersion'), 1n);
});
