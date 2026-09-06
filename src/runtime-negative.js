'use strict';

function buildTamperedProofs(proof) {
  const rootTampered = structuredClone(proof);
  rootTampered.merkleProof.root = `0x${'11'.repeat(32)}`;

  const bytesTampered = structuredClone(proof);
  const lastByte = Number.parseInt(bytesTampered.txBytes.slice(-2), 16) ^ 1;
  bytesTampered.txBytes = `${bytesTampered.txBytes.slice(0, -2)}${lastByte.toString(16).padStart(2, '0')}`;

  const continuityTampered = structuredClone(proof);
  continuityTampered.continuityProof.lowerEndpointDigest = `0x${'22'.repeat(32)}`;

  return { rootTampered, bytesTampered, continuityTampered };
}

function contractErrorName(error, iface) {
  if (typeof error?.revert?.name === 'string') return error.revert.name;
  if (typeof error?.errorName === 'string') return error.errorName;
  const data = error?.data || error?.info?.error?.data || error?.error?.data;
  if (typeof data !== 'string') return null;
  try {
    return iface.parseError(data)?.name || null;
  } catch {
    return null;
  }
}

function evidenceClock(now = () => new Date().toISOString()) {
  return { startedAt: now(), completedAt: () => now() };
}

module.exports = { buildTamperedProofs, contractErrorName, evidenceClock };
