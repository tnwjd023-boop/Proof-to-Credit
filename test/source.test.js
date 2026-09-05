'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AbiCoder, getAddress, keccak256, toUtf8Bytes } = require('ethers');
const { deployContract, loadArtifact } = require('./helpers/vm');

const borrower = '0x1000000000000000000000000000000000000001';
const attacker = '0x2000000000000000000000000000000000000002';
const assetId = keccak256(toUtf8Bytes('DEMO_GOLD_REFERENCE_001'));
const unitId = keccak256(toUtf8Bytes('DEMO_USD_6'));
const OPEN = 50_000_000n;
const REPAY = 20_000_000n;

async function deployLoan() {
  return deployContract('SingleDrawLoanMock', [assetId, unitId, borrower], { caller: borrower });
}

test('external mutation surface contains only initial open and repayment', () => {
  const mutations = loadArtifact('SingleDrawLoanMock').abi
    .filter((entry) => entry.type === 'function' && !['view', 'pure'].includes(entry.stateMutability))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(mutations, ['openDebt', 'repayDebt']);
});

function stateTuple(decoded) {
  return {
    opened: decoded.opened_,
    principal: decoded.principalOpened_,
    repaid: decoded.totalRepaid_,
    outstanding: decoded.outstanding_,
    sequence: decoded.sequence_,
  };
}

test('open50 then repay20 keeps storage and event fields in lockstep', async () => {
  const loan = await deployLoan();
  const expectedLoanId = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'bytes32', 'address', 'uint256'],
      [11155111n, loan.address, assetId, borrower, 1n],
    ),
  );
  assert.equal(await loan.readOne('loanId'), expectedLoanId);

  const opened = await loan.write('openDebt', [OPEN], { caller: borrower });
  assert.equal(opened.events.length, 1);
  assert.equal(opened.events[0].name, 'DebtOpened');
  assert.equal(opened.events[0].topics.length, 4);
  assert.equal((opened.events[0].data.length - 2) / 2, 160);
  assert.deepEqual(
    [...opened.events[0].args],
    [assetId, expectedLoanId, getAddress(borrower), unitId, 1n, OPEN, OPEN, opened.blockTimestamp],
  );
  assert.deepEqual(stateTuple(await loan.read('getLoanState')), {
    opened: true,
    principal: OPEN,
    repaid: 0n,
    outstanding: OPEN,
    sequence: 1n,
  });

  const repaid = await loan.write('repayDebt', [REPAY], { caller: borrower });
  assert.equal(repaid.events.length, 1);
  assert.equal(repaid.events[0].name, 'DebtRepaid');
  assert.equal(repaid.events[0].topics.length, 4);
  assert.equal((repaid.events[0].data.length - 2) / 2, 192);
  assert.deepEqual(
    [...repaid.events[0].args],
    [assetId, expectedLoanId, getAddress(borrower), unitId, 2n, REPAY, REPAY, 30_000_000n, repaid.blockTimestamp],
  );
  assert.deepEqual(stateTuple(await loan.read('getLoanState')), {
    opened: true,
    principal: OPEN,
    repaid: REPAY,
    outstanding: 30_000_000n,
    sequence: 2n,
  });
});

test('second open and reopen after full repayment both revert without mutation', async () => {
  const loan = await deployLoan();
  await loan.write('openDebt', [OPEN], { caller: borrower });
  const afterOpen = stateTuple(await loan.read('getLoanState'));
  await assert.rejects(() => loan.write('openDebt', [1n], { caller: borrower }), /AlreadyOpened/);
  assert.deepEqual(stateTuple(await loan.read('getLoanState')), afterOpen);

  await loan.write('repayDebt', [OPEN], { caller: borrower });
  const afterFullRepay = stateTuple(await loan.read('getLoanState'));
  assert.deepEqual(afterFullRepay, {
    opened: true,
    principal: OPEN,
    repaid: OPEN,
    outstanding: 0n,
    sequence: 2n,
  });
  await assert.rejects(() => loan.write('openDebt', [OPEN], { caller: borrower }), /AlreadyOpened/);
  assert.deepEqual(stateTuple(await loan.read('getLoanState')), afterFullRepay);
});

test('unauthorized, zero, pre-open, and over-repayment calls revert without mutation', async () => {
  const loan = await deployLoan();
  const initial = stateTuple(await loan.read('getLoanState'));
  await assert.rejects(() => loan.write('openDebt', [OPEN], { caller: attacker }), /NotBorrower/);
  await assert.rejects(() => loan.write('openDebt', [0n], { caller: borrower }), /ZeroAmount/);
  await assert.rejects(() => loan.write('repayDebt', [1n], { caller: borrower }), /MissingOpening/);
  assert.deepEqual(stateTuple(await loan.read('getLoanState')), initial);

  await loan.write('openDebt', [OPEN], { caller: borrower });
  const opened = stateTuple(await loan.read('getLoanState'));
  await assert.rejects(() => loan.write('repayDebt', [1n], { caller: attacker }), /NotBorrower/);
  await assert.rejects(() => loan.write('repayDebt', [0n], { caller: borrower }), /ZeroAmount/);
  await assert.rejects(() => loan.write('repayDebt', [50_000_001n], { caller: borrower }), /OverRepayment/);
  assert.deepEqual(stateTuple(await loan.read('getLoanState')), opened);
});
