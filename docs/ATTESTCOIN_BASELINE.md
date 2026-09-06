# Attestcoin read-only baseline

Current status: **VERIFIED** by direct runtime execution on `2026-09-05T22:49:17.857Z` (`2026-09-06 07:49:17 KST`).

The probe records health, source head, attested height, selected public Sepolia transaction, proof position, on-chain `calculateTxIndex`, normal verification, and independent root/continuity tamper controls under `runs/probe/`.

T06 extends that read-only spike with our own T05 `DebtOpened` transaction. Its persisted proof is `runs/20260906-t05/proofs/debt-opened.json`: source block `11643709`, transaction index `80`, normal CC3 runtime verdict `true`, with both Merkle-root and continuity-endpoint negative controls rejected.

ABI provenance:

- `verify`, `verifyAndEmit`, and `calculateTxIndex` follow the Creditcoin USC v2 migration documentation and the fixed reference revision.
- The live runtime result, not ABI construction alone, determines whether a selector is supported.
- `verifyAndEmit.staticCall` is an `eth_call`; it does not emit a persisted event or update application storage.

This file must not be upgraded to VERIFIED merely because a local mock or Proof Builder HTTP response succeeds.

## Direct measurements

| Item | Result |
|---|---|
| Proof API health | healthy; CC3 RPC and Ethereum RPC connected |
| Source / destination IDs | Sepolia `11155111`; CC3 `102031`; Attestcoin `chainKey=1` |
| Source head / attested height | `11643324` / `11643290` |
| Observed lag | `34` blocks, approximately `6.8` minutes at the configured 12-second block time |
| Public Sepolia transaction | `0x6714a6bfa1947b52dd58d22154e0dbe9e1ae1d5bdec28d952b8f0ccc7a02494e` |
| Block / proof tx index | `11642790` / `0` |
| `calculateTxIndex` | `0`, matching the proof response |
| Normal proof | `verify(...) == true` through CC3 BlockProver |
| Root tamper | Reverted: `Merkle proof validation failed` |
| Continuity tamper | Reverted: `Continuity proof does not match attestation or checkpoint` |

Evidence: `runs/probe/2026-09-05T22-49-17.857Z.json`.

The successful `eth_call` is not a persisted event, application storage update, deployment, or T07 E2E result.

## Availability note

During the completion recheck, `/health` briefly returned `degraded` with `cc3_rpc_connected=false` after a successful healthy response. The scripts now fail closed on that response and cap each HTTP/RPC request at 15 seconds. This is an external availability observation, not a tamper-rejection result.
