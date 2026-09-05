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
