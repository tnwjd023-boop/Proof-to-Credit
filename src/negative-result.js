'use strict';

function classifyNegativeEvidence(evidence) {
  try {
    if (
      evidence.sourceChainId !== '11155111' ||
      evidence.destinationChainId !== '102031' ||
      evidence.callMode !== 'eth_call' ||
      evidence.stateBeforeHash !== evidence.stateAfterHash ||
      evidence.replay?.rejected !== true ||
      evidence.replay?.errorName !== 'AlreadyProcessed'
    ) return 'BLOCKED';

    const requiredKinds = new Set(['debt-opened', 'debt-repaid']);
    if (!Array.isArray(evidence.proofs) || evidence.proofs.length !== requiredKinds.size) return 'BLOCKED';
    for (const proof of evidence.proofs) {
      if (!requiredKinds.delete(proof.kind)) return 'BLOCKED';
      if (
        BigInt(proof.chainKey) !== 1n ||
        BigInt(proof.headerNumber) !== BigInt(proof.sourceBlockNumber) ||
        BigInt(proof.derivedIndex) !== BigInt(proof.txIndex) ||
        proof.normal?.verdict !== true ||
        proof.rootTampered?.verdict !== false ||
        proof.bytesTampered?.verdict !== false ||
        proof.continuityTampered?.verdict !== false
      ) return 'BLOCKED';
    }
    return requiredKinds.size === 0 ? 'VERIFIED' : 'BLOCKED';
  } catch {
    return 'BLOCKED';
  }
}

module.exports = { classifyNegativeEvidence };
