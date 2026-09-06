# Progress

## Environment baseline — 2026-09-06 KST

- T0: 2026-09-06 (exact session timestamp is not available from the supplied plan).
- Worktree/commit: **BLOCKED** — `git` is not installed or available on PATH in the execution environment.
- Initial runtime: **BLOCKED**, then locally recoverable — `node` and `npm` were not on PATH; official portable Node.js 22 is stored under ignored `.tools/`.
- Reference revision: `0dec5aef93937b9fd1d8ef02a83455e146eafe24`.
- Exact reference resolutions: ethers `6.17.0`, solc `0.8.36`, dotenv `17.4.2`, `@gluwa/usc-sdk` `0.18.0`, `@gluwa/usc-contracts` `0.1.2`.
- No private key was read, created, printed, or stored. Mainnet writes remain disabled.

Task acceptance details and command output will be appended after execution.

## T01 — environment baseline

- Status: **DONE_WITH_CONCERNS**.
- Changed: `package.json`, `package-lock.json`, `.gitignore`, `.env.example`, `src/config.js`, `scripts/check-env.js`, `docs/SPEC.md`, `docs/PROGRESS.md`, `docs/CLAIMS.md`.
- `npm ci --ignore-scripts`: 48 packages installed; lockfile reproducible.
- `node scripts/check-env.js`: source chain `11155111` at block `11643320`; destination chain `102031` at block `5437241`; Proof API healthy; writes disabled.
- Official current deadline check: the organizer site states `2026-09-13 23:59 ET`, which converts to `2026-09-14 12:59 KST`. The plan's `2026-09-13 18:00 KST` remains the safer internal target and is not presented as the official deadline.
- Official event information says every submission must use Attestcoin. The DoraHacks detail page itself returned HTTP 405 to automated retrieval, so exact form fields/video requirements remain **UNKNOWN** and must be checked interactively before T18.
- Dependency audit: 1 low and 1 high report, both through `solc@0.8.36 -> tmp@0.0.33`; the high advisory concerns path traversal via unsanitized prefix/postfix. No automatic major downgrade was applied because the plan fixes the reference compiler version. Treat compiler inputs and temp paths as trusted during this prototype and revisit before release.
- Commit SHA: **BLOCKED** — no `git` executable is available.

## T02 — actual Attestcoin read-only spike

- Status: **DONE**.
- Changed: `contracts/interfaces/INativeQueryVerifier.sol`, `scripts/probe-proof.js`, `docs/ATTESTCOIN_BASELINE.md`, `runs/probe/2026-09-05T22-49-17.857Z.json`.
- Command: `node scripts/probe-proof.js` using the project-local portable Node.js.
- Input: public Sepolia transaction `0x6714a6bfa1947b52dd58d22154e0dbe9e1ae1d5bdec28d952b8f0ccc7a02494e` at block `11642790`.
- VERIFIED: Proof Builder returned tx index `0`; CC3 `calculateTxIndex` returned `0`; `verify` returned `true`.
- VERIFIED negative controls: mutated Merkle root and continuity endpoint both reverted with layer-specific validation errors.
- Remaining risk: hosted RPC/API availability and attestation lag are external. This proof is not for our future `DebtOpened` event and does not update application storage.
- Follow-up reliability check: the Proof API changed from `healthy` to `degraded` with `cc3_rpc_connected=false` within seconds. The initial proof verification remains timestamped evidence, but a later fresh probe was correctly reported as **BLOCKED** rather than PASS.
- Regression fix: `check-env` and `probe-proof` now require semantic health (`status=healthy` and both upstream RPC flags true), use 15-second HTTP/RPC timeouts, and destroy providers. `node test/health.test.js` passed 2/2. RED first failed because `src/health.js` did not exist; GREEN passed both healthy and degraded cases.
- Review fix: final VERIFIED classification now also requires derived tx index, proof tx index, chain key, and source block height to match. Its RED test first failed with missing `src/probe-result.js`; the full GREEN suite passed 5/5.
- Commit SHA: **BLOCKED** — no `git` executable is available.

## T03 start condition

Satisfied for decoder/VM work: exact compiler/dependency baseline exists, a real proof bundle can be fetched, and the live verifier ABI works. T03 must cross-check decoded receipt status and logs against the Sepolia RPC before T04 begins.

## T03 — compile, VM, and decoder fixture

- Status: **DONE**.
- Changed: `package.json`, `package-lock.json`, `scripts/compile.js`, `contracts/interfaces/IEvmDecoder.sol`, `contracts/vendor/EvmV1Decoder.sol`, `test/helpers/vm.js`, `test/helpers/proof-mocks.sol`, `test/fixtures/sepolia-proof.json`, `test/compiler.test.js`, `test/decoder.test.js`, `docs/DECODER_BASELINE.md`, `docs/PROGRESS.md`.
- Exact VM dependencies: `@ethereumjs/common@4.4.0`, `@ethereumjs/tx@5.4.0`, `@ethereumjs/util@9.1.0`, `@ethereumjs/vm@8.1.1`.
- Compiler acceptance: solc `0.8.36`, `viaIR=true`, `evmVersion=paris`, optimizer enabled/runs `200`; decoder deployed code hash `0x6af1caad44e16d0090d318227b4a6feedc490e6c63399dcc642018d9968dc38d`.
- TDD RED 1: `node test/decoder.test.js` failed because `test/helpers/vm.js` did not exist.
- TDD GREEN 1: actual type/status/gas/topics/data decoding plus unsupported and malformed inputs passed 3/3.
- TDD RED 2: compiler settings test failed because `TestOnlyVerifierMock` was absent from artifacts.
- TDD GREEN 2: compiler now includes `contracts/` and `test/helpers/*.sol`; compiler test passed 1/1.
- Fresh RPC cross-check: transaction `0x58024bb55f0357e3e8fdb0791e0e8248c9ac7c3680b9634d1f6209bb8046d40c`, block `11642790`, index `17`, type `2`, status `1`, gas `50636`, two logs; every address/topic/data field matched.
- Verifier boundary: `TestOnlyVerifierMock` remains under the test tree. T03 does not claim local cryptographic proof verification.
- Commit SHA: **BLOCKED** — no `git` executable is available.
- T04 start condition: satisfied; the source single-draw state machine can now be implemented against a fixed compiler and VM path.

## T04 — source single-draw state machine

- Status: **DONE**.
- Changed: `contracts/source/SingleDrawLoanMock.sol`, `test/source.test.js`, `test/helpers/vm.js`, `docs/SOURCE_BASELINE.md`, `docs/PROGRESS.md`.
- TDD RED: `node test/source.test.js` failed because the stateful `deployContract` VM helper did not exist.
- First GREEN attempt exposed the documented EthereumJS API distinction: `runCode` returns `ExecResult`, while `runCall` wraps it as `execResult`. The helper was corrected at that boundary.
- GREEN: source-focused suite passed 4/4, covering the exact external mutation surface, open50→repay20, event/storage consistency, second open, reopen after full repayment, unauthorized calls, zero amounts, pre-open repay, and over-repayment with state invariance.
- Compiler: solc `0.8.36`, `viaIR=true`, `evmVersion=paris`, optimizer runs `200`.
- Artifact: 1,506 deployed bytes, code hash `0x50468dfcb559cc885cbc6d4310d8a4d4c00f6f52d27ee94e0920e36a63e4df6d`.
- Review: ABI exposes only `openDebt` and `repayDebt` as state-mutating functions; only `DebtOpened` and `DebtRepaid` events exist. `principalOpened` has no post-open increase path, and `opened` has no reset path.
- Evidence level: local VM only. No Sepolia deployment or actual source event is claimed before T05.

## T05 preparation — testnet-only signer

- Status: **DONE**. Both faucets were funded and T05 was executed on Sepolia.
- Generated public address: `0x122409763443d94060fAc61676d50c0B1006f49F`.
- The private key exists only in the ignored local `.env`. It was not printed, copied into documentation, staged, or committed.
- Pre-deployment balance check on 2026-09-06 KST: Sepolia ETH `0.05`; Creditcoin CC3 Testnet tCTC `10000`.
- Creditcoin's official faucet flow is Discord `token-faucet` → `/faucet address:<EVM address>`: <https://docs.creditcoin.org/wallets/using-testnet-faucet>.
- Sepolia faucet options are listed by Ethereum.org: <https://ethereum.org/developers/docs/networks/#sepolia>.
- Safety boundary: this is a plaintext testnet-only development key. Never send mainnet ETH, production CTC, stablecoins, or any asset with real value to it.

## T05 — Source deployment and first event

- Status: **DONE — PUBLIC TESTNET EVIDENCE**.
- Run: `20260906-t05`; public manifest: `runs/20260906-t05/manifest.json`.
- Sepolia chain ID was checked as `11155111` before both signed transactions.
- Source contract: `0x0c93759f8eC91B348D8C53EA03C1ae78ED543760`.
- Deployment transaction: `0x8045ae26416b9d3844834747c34f28743ab423830cc9a08b674385feb02f0355`; receipt status `1`; deployed code `1,506` bytes; runtime code hash `0x192b3f605cc60b9ac70c17d16a9adfba195441c11ef0b140629fee784c533739`.
- First opening transaction: `0xa5c0954a0b148e84d37c68a87fc9d37d77c548f1aed4d522ee0c9009f92042cd`; receipt status `1`; block `11643709`.
- `DebtOpened` and getters agree: loan ID `0xf75242025a45e9d02bdb54af3e4b5c791fcd9c92704f3cd8d6ef558dc632dc2c`, sequence `1`, principal/outstanding `50,000,000`, cumulative repayment `0`.
- Immutable scope: borrower `0x122409763443d94060fAc61676d50c0B1006f49F`, asset ID `0x4ac423f580111ce6c4fe187d4113c368aab45204509f55000ec90d4eb77a23e7`, unit ID `0xf013d3d74e873543dc0fbc4db2cda2753bb12e048dba74e108de8bf217543310`.
- No token or real funds were lent. The contract records mock principal only; Sepolia ETH paid testnet gas.

## T06 — Worker proof fetch, persistence, and conversion

- Status: **DONE — ACTUAL ATTESTCOIN PROOF VERIFIED**.
- Input: T05 `DebtOpened` transaction `0xa5c0954a0b148e84d37c68a87fc9d37d77c548f1aed4d522ee0c9009f92042cd`, Sepolia block `11643709`, transaction index `80`, expected chain key `1`.
- The worker observed the documented 32-block reorg-protection window, then waited through `retriable=true` HTTP 404/422 responses at 15-second intervals until the block was attested. Total live execution time was about four minutes, below the 30-minute limit.
- Stored lossless proof bundle and flattened verifier fields: `runs/20260906-t05/proofs/debt-opened.json`. All integer fields are decimal strings to avoid JSON number loss.
- Source receipt cross-check: proof header `11643709` and tx index `80` match the successful Sepolia receipt; proof chain key is `1`.
- CC3 BlockProver runtime verification: derived index `80`; normal `verify=true`; mutated Merkle root rejected; mutated continuity endpoint rejected.
- Classification requires all source-position and runtime checks. An API success response alone does not produce `VERIFIED`.

## T07 — First destination principal record

- Status: **DONE — PUBLIC CC3 TESTNET STATE**.
- Network ID `102031` was checked before deployment and submission. The fixed production verifier is `0x0000000000000000000000000000000000000FD2`.
- Decoder: `0x0c93759f8eC91B348D8C53EA03C1ae78ED543760`; deployment transaction `0x8eb7f7b96e5165c799488586ba4dd793c06b834fdeee8b977e01b2396f3370d5`; code hash `0x6af1caad44e16d0090d318227b4a6feedc490e6c63399dcc642018d9968dc38d`.
- Gate: `0xf2BBE3B025Cc5733fD821D4E6BbE2ba0Cee714Fa`; deployment transaction `0xe1aafce1b613e31634d4df8b4bd0fad1ae4bef83a208133a9228ed58db7ed168`; code hash `0x93cd0be4bcd201e5a152c91f5341fcbf4411f71e1741b9f60bc2b74621828802`.
- Proof submission transaction: `0xd3ca305c5dc56048f6b15de1b4f3247d117c34ff72fe07be3d6e17ed870dc5d9`; receipt status `1`; CC3 block `5437680`.
- Stored state: `initialized=true`, principal/verified debt `50,000,000`, total repaid `0`, sequence `1`, source block `11643709`, source tx index `80`, state version `1`.
- Independent read-only checks rejected replay as `AlreadyProcessed`, chain key `2` as `WrongSourceChain`, and a mutated Merkle root. Local VM tests also reject failed verifier and non-allowlisted emitter without state mutation.

## T08 — Sequence, position, and transaction replay safety

- Status: **DONE — LOCAL SECURITY INVARIANTS**. No replacement CC3 deployment was made in this task.
- Query identity is `keccak256(abi.encode(chainKey, blockHeight, verifiedTxIndex))`; event identity adds the receipt `logIndex`.
- Source positions use strict lexicographic ordering over `(blockHeight, txIndex, logIndex)`, including explicit same-block and same-transaction vectors.
- A successful query is marked processed only after all matching logs have been applied. Any invalid matching log reverts the transaction, so partial state and processed markers roll back together.
- Replay fails without increasing `stateVersion`; a failed batch leaves its query unprocessed so the same source transaction can be retried after the missing prerequisite is accepted.
- TDD RED: compilation failed because `contracts/cc3/SourcePosition.sol` did not exist. GREEN: `test/sequence.test.js` passed 3/3 and the T07 admission suite remained green.

## T09 — Repayment and principal reconstruction

- Status: **DONE — PUBLIC SEPOLIA AND CC3 TESTNET EVIDENCE**.
- Sepolia `repayDebt(20,000,000)` transaction: `0x326c666d0208e6f1625396a559cb78bb4e7783c56eda52c11643e7339cba0687`; block `11643980`; event/getters agree on cumulative repayment `20,000,000`, outstanding `30,000,000`, sequence `2`.
- Attestcoin proof: `runs/20260906-t05/proofs/debt-repaid.json`; chain key `1`, source tx index `77`; normal CC3 runtime verification true with Merkle and continuity tamper controls rejected.
- A stale saved opening continuity path was correctly rejected before transaction broadcast. Diagnosis showed the Merkle root unchanged while continuity roots advanced from 2 to 92. The worker now supports explicit `--refresh`, backed by a regression test, and both proofs were refreshed before submission.
- T09 decoder: `0x499651Aa184D1c43bD2C52E00831E30fE95Cd8c9`; gate: `0x9c3b41eecAB34ab5089675C1a5Ab38C43f4E7A51`.
- Opening proof submission: `0x3f1906482b0775641b9c384ea04ce3f369a462b73bf05b512089c92728b1bbf8`; repayment proof submission: `0x56c78561186d8deb5cc7d96a19a91026e73e1902f1f0647953ca70be15fa28f1`.
- Final CC3 state: initialized, principal `50,000,000`, cumulative repayment `20,000,000`, verified debt `30,000,000`, sequence `2`, source block `11643980`, source tx index `77`, state version `2`.
- Local negative tests reject repayment before opening, sequence gaps, wrong unit, zero/over repayment, inconsistent cumulative repayment, and inconsistent outstanding amount without state residue.

## T10 — Explainable credit-limit policy

- Status: **DONE — LOCAL POLICY INVARIANTS**. No replacement CC3 deployment was made in this task.
- `evaluate` returns only `ALLOW`, `UNINITIALIZED`, `ZERO_AMOUNT`, or `OVER_LIMIT`, together with observed headroom, proposed utilization, state hash, and fact/policy versions.
- Before proof initialization, headroom is the sentinel `0` rather than the configured limit. After opening at debt50/limit60, request30 is rejected with headroom10 and proposed utilization80.
- After verified repayment produces debt30, request30 is allowed exactly at limit60; request `30,000,001` is rejected and the minimum unit `1` is allowed.
- Only immutable `policyOwner` may set a positive limit. Reducing the limit below current debt produces headroom0 and preserves the verified debt unchanged.
- `headroom = max(creditLimit - verifiedDebt - committedCredit, 0)`. No gold quantity, price, or collateral value enters this policy calculation.
- TDD RED: policy tests failed because `evaluate` and `setPolicy` were absent. GREEN: `test/policy.test.js` passed 3/3.

## T11 — Atomic credit commitment and version races

- Status: **DONE — LOCAL ATOMICITY INVARIANTS**. The complete T12 testnet deployment remains pending.
- `commitCredit(amount, expectedStateVersion, expectedPolicyVersion)` independently rechecks immutable borrower authority, initialization, both versions, positive amount, and current headroom.
- At verified debt30/limit60, commit30 succeeds atomically, increases `committedCredit` to 30 and fact `stateVersion` from 2 to 3, then request1 fails with zero headroom.
- Two requests using the same fact version cannot both consume capacity: the first transition succeeds and the second fails `StaleStateVersion` even when both amounts would otherwise fit.
- A policy change increments `policyVersion`, so a commitment carrying the earlier policy version fails. Unauthorized, uninitialized, zero, and over-limit paths leave state unchanged.
- `CreditCommitted` records the borrower, amount, resulting commitment, both versions, and the pre-transition state hash.
- TDD RED: all four cases failed because `commitCredit` was absent. GREEN: `test/commitment.test.js` passed 4/4.

## T12 — Complete testnet financial-state demo

- Status: **DONE — VERIFIED PUBLIC TESTNET DEMO**.
- Final decoder: `0x8006e5fdE6AC19A86D8bAe018191e2b12a3eB01E`; final gate: `0xC97b7EA6de5fc4Cb39D7Fc52881B3d98f4b68147` on CC3 chain `102031`.
- Opening proof submission: `0xf6587f667a069b272c9650e6dfdaf577c0b020ece3c200b8da85e2e5df890ebd`; repayment proof submission: `0xe13a4974cb8c79b5c81163081991b3a6e0823f4c4b382f0ef8ae8ab25e8dbcc0`.
- At debt50, request30 was rejected: headroom10, proposed utilization80, reason `OVER_LIMIT`.
- After the actual repay20 proof produced debt30, request30 was allowed exactly at limit60: headroom30, proposed utilization60.
- Commit30 transaction: `0xcf3d79a7d50c87dfc860bd067da91357c8bc695b5b48fb035cefa4571e3dbb20`; receipt status `1`, CC3 block `5438009`.
- After commit, request1 was rejected: committed credit30, headroom0, proposed utilization `60,000,001`, state version3, policy version1.
- The run records source events, proof applications, and the policy commitment as distinct transactions. No real lending or token transfer occurred.
- TDD RED: scenario test failed because `src/scenario-result.js` was absent. GREEN: the local reject→allow→commit→reject scenario passed before testnet execution.

## T13 — Application security and negative suite

- Status: **DONE — LOCAL APPLICATION SECURITY MATRIX**.
- Added `test/security.test.js` with eight attack groups covering failed receipts, emitter/signature/identity mismatch, malformed ABI, repayment arithmetic and timestamps, repayment after full repayment, duplicate matching logs, replay/order, authorization residue, and extreme-value fail-closed behavior.
- Failed submissions assert unchanged `stateVersion`, `verifiedDebt`, `totalRepaid`, and position-derived `processedQueries`; the duplicate-log test confirms whole-batch rollback.
- Added `docs/TEST_MATRIX.md` to separate local verifier-mock application evidence, real receipt decoding, actual BlockProver evidence, and actual CC3 storage evidence.
- Corrected claim scope: `sourceEvmChainId` is stored but not independently checked; REJECT is a view result; the policy testnet claim now points to canonical T12.
- No production contract change was required. Runtime tamper packaging remains T14; proof preflight/refresh and reusable evidence tooling remain T15.

## T14 — Actual runtime negative evidence

- Status: **DONE — ACTUAL CC3 READ-ONLY NEGATIVE EVIDENCE**.
- Added `scripts/demo-negative.js`, pure result/tamper helpers, and six focused unit tests developed through two RED→GREEN cycles.
- At observed CC3 block `5439094`, both saved source proofs returned true through BlockProver; independent Merkle-root, transaction-bytes, and continuity-endpoint mutations were rejected for each proof.
- A read-only replay of the opening proof against canonical T12 gate `0xC97b7EA6de5fc4Cb39D7Fc52881B3d98f4b68147` decoded to `AlreadyProcessed`.
- Canonical application state hash was identical before and after all calls: `0xf7185a0001933e757aeb3facc0eb10387bd7682552e4c04d5bd0cf39e3090063`.
- Evidence: `runs/20260906-t05/negative.json`. All results are `eth_call`; no transaction was broadcast and no rejection log or receipt was created.

## T15 — Resumable CLI and evidence packaging

- Status: **DONE — RESUMABLE AND READ-ONLY RE-AUDITED**.
- Added `scripts/resume.js`. It reads the run manifest, identifies the next incomplete step, and never signs or broadcasts. A supplied recovery transaction must exist on CC3 and target the selected gate.
- Proof submission now checks the exact saved bundle through the live BlockProver before signer construction. An invalid or stale bundle is refreshed once for the same source transaction and must pass runtime verification again before broadcast.
- Removed run-specific repayment constants from submission acceptance. Principal, cumulative repayment, outstanding debt, sequence, block height, and transaction index are derived from the manifest and verified proof.
- Every broadcastable step records transaction identity immediately after broadcast: source deployment/open/repay, decoder/gate deployment, proof submission, and credit commitment. Recovery checks hash, sender, chain, target, calldata hash, value, receipt status, and step-specific state before finalizing instead of sending a duplicate. Completed steps return `COMPLETE`.
- Manifest updates use secret-screened atomic JSON replacement; initial run creation is exclusive and refuses an existing manifest. Public proof and negative JSON paths are explicitly allowed by `.gitignore`.
- `test/resume.test.js` covers incomplete-step planning across source and destination journals, pending receipt and full transaction identity checks, same-destination replay avoidance, new-destination proof reuse, proof readiness, dynamic expectations, hash-bound finalization, BigInt serialization, exclusive creation, atomic replacement, and credential-field rejection.
- Read-only canonical re-audit: `node scripts/resume.js --run 20260906-t05 --slot destinationT12` verified eight successful receipts, all three deployed code hashes, `verifiedDebt=30000000`, and `committedCredit=30000000`; result `COMPLETE`.
- Actual receipt-recovery exercise: `runs/t15-recovery-check/manifest.json` rebuilt source deploy/open/repay and decoder/gate deployment records from five already-public T05 transaction hashes, clearing each pending journal without broadcasting.
- No new testnet transaction was sent for T15. Proof/commit interruption edges are covered deterministically at the journal/receipt state-machine boundary; the completed public run is revalidated through read-only RPC.
