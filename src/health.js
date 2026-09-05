'use strict';

function assertHealthyProofApi(health) {
  const status = health?.status;
  const cc3 = health?.cc3_rpc_connected;
  const ethereum = health?.eth_rpc_connected;
  if (status !== 'healthy' || cc3 !== true || ethereum !== true) {
    throw new Error(
      `Proof API is ${status || 'unknown'}: cc3_rpc_connected=${String(cc3)}, eth_rpc_connected=${String(ethereum)}`,
    );
  }
  return health;
}

module.exports = { assertHealthyProofApi };
