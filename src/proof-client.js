'use strict';

const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_BYTES = /^0x(?:[0-9a-fA-F]{2})+$/;
const POLL_INTERVAL_MS = 15_000;
const TIMEOUT_MS = 30 * 60 * 1000;

function integerString(value, field) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`${field} is not a safe integer`);
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error();
    return parsed.toString();
  } catch {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

function requireHash(value, field) {
  if (!HEX_32.test(value || '')) throw new Error(`${field} must be bytes32 hex`);
  return value;
}

function normalizeProof(raw, expected = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('proof must be an object');
  const chainKey = integerString(raw.chainKey, 'chainKey');
  const headerNumber = integerString(raw.headerNumber, 'headerNumber');
  const txIndex = integerString(raw.txIndex, 'txIndex');
  if (expected.chainKey !== undefined && BigInt(chainKey) !== BigInt(expected.chainKey)) throw new Error('proof chainKey mismatch');
  if (expected.headerNumber !== undefined && BigInt(headerNumber) !== BigInt(expected.headerNumber)) throw new Error('proof headerNumber mismatch');
  if (!HEX_BYTES.test(raw.txBytes || '')) throw new Error('txBytes must be non-empty even-length hex');
  if (!Array.isArray(raw.merkleProof?.siblings)) throw new Error('merkleProof.siblings must be an array');
  if (!Array.isArray(raw.continuityProof?.roots)) throw new Error('continuityProof.roots must be an array');
  return {
    chainKey,
    headerNumber,
    txIndex,
    txBytes: raw.txBytes,
    cached: Boolean(raw.cached),
    merkleProof: {
      root: requireHash(raw.merkleProof.root, 'merkleProof.root'),
      siblings: raw.merkleProof.siblings.map((node, index) => ({
        hash: requireHash(node?.hash, `merkleProof.siblings[${index}].hash`),
        isLeft: (() => {
          if (typeof node?.isLeft !== 'boolean') throw new Error(`merkleProof.siblings[${index}].isLeft must be boolean`);
          return node.isLeft;
        })(),
      })),
    },
    continuityProof: {
      lowerEndpointDigest: requireHash(raw.continuityProof.lowerEndpointDigest, 'continuityProof.lowerEndpointDigest'),
      roots: raw.continuityProof.roots.map((root, index) => requireHash(root, `continuityProof.roots[${index}]`)),
    },
  };
}

function verifierArgs(proof) {
  return [
    BigInt(proof.chainKey),
    BigInt(proof.headerNumber),
    proof.txBytes,
    [proof.merkleProof.root, proof.merkleProof.siblings.map((node) => [node.hash, node.isLeft])],
    [proof.continuityProof.lowerEndpointDigest, proof.continuityProof.roots],
  ];
}

async function fetchProof(options) {
  const {
    baseUrl,
    chainKey,
    txHash,
    headerNumber,
    fetchImpl = fetch,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now = Date.now,
    onProgress = () => {},
  } = options;
  const started = now();
  const url = `${baseUrl}/proof-by-tx/${chainKey}/${txHash}`;
  for (;;) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    if (response.ok) return normalizeProof(body, { chainKey, headerNumber });
    if (!body?.retriable) throw new Error(`proof API HTTP ${response.status}: ${body?.message || 'non-retriable response'}`);
    if (now() - started >= TIMEOUT_MS) throw new Error('30 minute timeout waiting for source attestation');
    onProgress({ status: response.status, message: body.message });
    await sleep(POLL_INTERVAL_MS);
  }
}

module.exports = { POLL_INTERVAL_MS, TIMEOUT_MS, fetchProof, normalizeProof, verifierArgs };
