'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVmHarness } = require('./helpers/vm');
const { verifierArgs } = require('../src/proof-client');
const { assertScenario } = require('../src/scenario-result');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'manifest.json')));
const opening = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'proofs', 'debt-opened.json'))).bundle;
const repayment = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runs', '20260906-t05', 'proofs', 'debt-repaid.json'))).bundle;
const owner = '0x3000000000000000000000000000000000000003';

test('reject → allow → commit → reject scenario consumes verified headroom', async () => {
  const harness = await createVmHarness({ caller: owner });
  const verifier = await harness.deploy('TestOnlyVerifierMock', [true]);
  const decoder = await harness.deploy('EvmV1Decoder', []);
  const gate = await harness.deploy('VerifiedDebtGate', [
    verifier.address, decoder.address, 1n, 11155111n, manifest.source.contractAddress,
    manifest.source.assetId, manifest.opening.loanId, manifest.source.unitId,
    manifest.source.borrower, owner, 60_000_000n,
  ]);
  await gate.write('submitSourceTransaction', verifierArgs(opening));
  const beforeRepayment = await gate.readOne('evaluate', [30_000_000n]);
  await gate.write('submitSourceTransaction', verifierArgs(repayment));
  const afterRepayment = await gate.readOne('evaluate', [30_000_000n]);
  await gate.write('commitCredit', [30_000_000n, 2n, 1n], { caller: manifest.source.borrower });
  const afterCommit = await gate.readOne('evaluate', [1n]);
  const result = assertScenario({ beforeRepayment, afterRepayment, afterCommit, committedCredit: await gate.readOne('committedCredit') });
  assert.equal(result.classification, 'VERIFIED');
  assert.deepEqual(result.headroomPath, ['10000000', '30000000', '0']);
});
