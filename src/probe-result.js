'use strict';

function classifyProbe(result) {
  const positionMatches =
    BigInt(result.derivedIndex) === BigInt(result.proofIndex) &&
    Number(result.proofHeight) === Number(result.sourceHeight) &&
    BigInt(result.proofChainKey) === BigInt(result.expectedChainKey);
  const runtimeMatches =
    result.normalVerdict === true &&
    result.rootTamperedVerdict === false &&
    result.continuityTamperedVerdict === false;
  return positionMatches && runtimeMatches ? 'VERIFIED' : 'BLOCKED';
}

module.exports = { classifyProbe };
