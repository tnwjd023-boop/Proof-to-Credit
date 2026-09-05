'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/sepolia-proof.json');
const { replaceFirstWord, runPureLibrary } = require('./helpers/vm');

test('actual decoder matches Sepolia receipt type, status, gas, topics, and data', async () => {
  const txBytes = fixture.proof.txBytes;
  const [txType] = await runPureLibrary('EvmV1Decoder', 'getTransactionType', [txBytes]);
  const [receipt] = await runPureLibrary('EvmV1Decoder', 'decodeReceiptFields', [txBytes]);

  assert.equal(Number(txType), Number(fixture.receipt.type));
  assert.equal(Number(receipt.receiptStatus), Number(BigInt(fixture.receipt.status)));
  assert.equal(receipt.receiptGasUsed, BigInt(fixture.receipt.gasUsed));
  assert.equal(receipt.receiptLogs.length, fixture.receipt.logs.length);
  assert.ok(receipt.receiptLogs.length > 0, 'fixture must exercise logs');

  for (let index = 0; index < receipt.receiptLogs.length; index += 1) {
    const decoded = receipt.receiptLogs[index];
    const source = fixture.receipt.logs[index];
    assert.equal(decoded.address_.toLowerCase(), source.address.toLowerCase());
    assert.deepEqual([...decoded.topics].map((value) => value.toLowerCase()), source.topics.map((value) => value.toLowerCase()));
    assert.equal(decoded.data.toLowerCase(), source.data.toLowerCase());
  }
});

test('decoder rejects an unsupported transaction type', async () => {
  const unsupported = replaceFirstWord(fixture.proof.txBytes, 5n);
  await assert.rejects(
    () => runPureLibrary('EvmV1Decoder', 'decodeReceiptFields', [unsupported]),
    /Invalid transaction type|revert/i,
  );
});

test('decoder rejects malformed encoded transaction bytes', async () => {
  await assert.rejects(
    () => runPureLibrary('EvmV1Decoder', 'decodeReceiptFields', ['0x1234']),
    /revert|exception|invalid/i,
  );
});
