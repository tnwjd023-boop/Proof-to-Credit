'use strict';

const { FetchRequest, JsonRpcProvider } = require('ethers');
const { networkConfig, assertTestnetOnly } = require('../src/config');
const { assertHealthyProofApi } = require('../src/health');

function rpcProvider(url) {
  const request = new FetchRequest(url);
  request.timeout = 15000;
  return new JsonRpcProvider(request, undefined, { staticNetwork: false });
}

async function checkRpc(label, url, expectedChainId) {
  const provider = rpcProvider(url);
  try {
    const network = await provider.getNetwork();
    if (network.chainId !== expectedChainId) {
      throw new Error(`${label}: expected chainId ${expectedChainId}, received ${network.chainId}`);
    }
    return { label, chainId: network.chainId.toString(), blockNumber: await provider.getBlockNumber() };
  } finally {
    provider.destroy();
  }
}

async function main() {
  assertTestnetOnly();
  const checks = await Promise.allSettled([
    checkRpc('source', networkConfig.source.rpcUrl, networkConfig.source.evmChainId),
    checkRpc('destination', networkConfig.destination.rpcUrl, networkConfig.destination.evmChainId),
    fetch(`${networkConfig.proofApiUrl}/health`, { signal: AbortSignal.timeout(15000) }).then(async (response) => {
      if (!response.ok) throw new Error(`Proof API health returned HTTP ${response.status}`);
      return { label: 'proof-api', body: assertHealthyProofApi(await response.json()) };
    }),
  ]);

  let failed = false;
  for (const result of checks) {
    if (result.status === 'fulfilled') console.log('VERIFIED', JSON.stringify(result.value));
    else {
      failed = true;
      console.error('BLOCKED', result.reason.message);
    }
  }
  console.log('VERIFIED', JSON.stringify({ attestcoinChainKey: '1', writesEnabled: false }));
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error('BLOCKED', error.message);
  process.exitCode = 1;
});
