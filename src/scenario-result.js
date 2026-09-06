'use strict';

function assertScenario({ beforeRepayment, afterRepayment, afterCommit, committedCredit }) {
  const matches =
    beforeRepayment.allowed === false && BigInt(beforeRepayment.reason) === 3n &&
    beforeRepayment.observedHeadroom === 10_000_000n && beforeRepayment.proposedUtilization === 80_000_000n &&
    afterRepayment.allowed === true && BigInt(afterRepayment.reason) === 0n &&
    afterRepayment.observedHeadroom === 30_000_000n && afterRepayment.proposedUtilization === 60_000_000n &&
    afterCommit.allowed === false && BigInt(afterCommit.reason) === 3n &&
    afterCommit.observedHeadroom === 0n && afterCommit.proposedUtilization === 60_000_001n &&
    committedCredit === 30_000_000n;
  if (!matches) throw new Error('testnet scenario does not match reject-allow-commit-reject acceptance');
  return {
    classification: 'VERIFIED',
    headroomPath: [beforeRepayment, afterRepayment, afterCommit].map((item) => item.observedHeadroom.toString()),
    committedCredit: committedCredit.toString(),
  };
}

module.exports = { assertScenario };
