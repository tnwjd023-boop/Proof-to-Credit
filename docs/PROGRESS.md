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
