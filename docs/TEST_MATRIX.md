# T13 security and evidence matrix

This matrix separates application behavior tested with a local verifier mock from actual Attestcoin runtime and public-testnet storage evidence. `TestOnlyVerifierMock(true)` proves only what `VerifiedDebtGate` does after verifier acceptance; it does not prove Merkle inclusion or continuity.

## Evidence levels

| Level | What it establishes | Current evidence |
|---|---|---|
| Local application | Receipt decoding, identity admission, ordering, sequence, arithmetic, rollback, policy, commitment | EthereumJS VM suites, including `test/security.test.js` |
| Real receipt bytes | Vendored decoder handles persisted Sepolia transaction envelopes | `test/decoder.test.js` and persisted proof bundles |
| Actual BlockProver | Runtime accepts normal Merkle/continuity proofs and rejects tampered controls | `runs/20260906-t05/proofs/*.json`; T14 will package fresh negative evidence |
| Actual CC3 storage | Proof submissions changed the canonical gate and commit consumed capacity | T12 transactions, manifest, and historical getters |

## Application security cases

Reverting security cases assert unchanged `stateVersion`, `verifiedDebt`, `totalRepaid`, and position-derived `processedQueries` where applicable.

| Case | Expected result | Protection | Evidence |
|---|---|---|---|
| wrong chain / verifier false | revert | Protected | `admission.test.js` |
| receipt status `0` with matching log | revert, no residue | Protected | synthetic receipt in `security.test.js` |
| fake emitter / wrong signature | revert, no residue | Protected | `admission.test.js`, `security.test.js` |
| wrong asset / loan / borrower / unit | revert, no residue | Protected | `security.test.js` |
| malformed matching log ABI | revert, no residue | Protected | `security.test.js` |
| repayment before opening | revert | Protected | `repayment.test.js` |
| zero / over repayment | revert | Protected | `repayment.test.js`, `security.test.js` |
| cumulative mismatch or greater than principal | revert, no residue | Protected | `repayment.test.js`, `security.test.js` |
| outstanding arithmetic mismatch | revert, no residue | Protected | `repayment.test.js`, `security.test.js` |
| source timestamp regression | revert, no residue | Protected | `security.test.js` |
| sequence gap | revert | Protected | `repayment.test.js` |
| exact replay / earlier source position | revert, no residue | Protected | `sequence.test.js`, `security.test.js` |
| duplicate matching log in one receipt | whole batch rolls back | Protected | synthetic batch in `security.test.js` |
| repayment after full repayment | revert, debt stays zero | Protected | `security.test.js` |
| unauthorized policy / commitment | revert, no residue | Protected | policy, commitment, and security suites |
| same-version competing commitments | only first transition succeeds | Protected | `commitment.test.js` |
| extreme `uint256` principal | evaluation panics and commitment rejects; no over-allocation | Partially protected / fail-closed | `security.test.js` |
| unseen tail repayment | destination may retain higher debt | Not proven by sequence; constrained by single-draw source | source mutation-surface tests |

Synthetic receipt tests do not claim Attestcoin accepted mutated bytes. The verifier mock deliberately returns `true` to isolate application checks. Actual cryptographic tamper rejection belongs to T14.

## Identity and decision limitations

- `sourceChainKey` is enforced by the gate and BlockProver. `sourceEvmChainId` is stored but is not separately decoded or checked during admission.
- `evaluate()` is a view call. REJECT is reproducible from historical state but is not a persistent rejection transaction or log.
- `commitCredit()` records a bounded accounting commitment only; it transfers no funds.
- Canonical T12 uses one EOA as source borrower, destination borrower, and policy owner. Execution domains are separated; independent institutions are not demonstrated.

## Deferred to T14 and T15

- T14: fresh BlockProver normal/root-tamper/continuity-tamper evidence and application replay `eth_call`, with target and block recorded.
- T15: submission-time proof preflight, bounded refresh/retry, manifest-derived expectations, resumable execution, and exact deployment artifact evidence.
