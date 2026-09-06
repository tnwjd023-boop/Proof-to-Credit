# T04 source single-draw baseline

## Result

**VERIFIED — local VM behavior.** `SingleDrawLoanMock` permits exactly one initial principal opening and thereafter only repayments. It is a mock accounting contract: it transfers no token or real funds.

## Fixed identities and state

- `assetId`, `unitId`, `borrower`, and computed `loanId` are immutable.
- `loanId = keccak256(abi.encode(11155111, sourceEmitter, assetId, borrower, uint256(1)))` in the Sepolia-configured VM.
- Successful `openDebt(50_000_000)` sets `opened=true`, principal/outstanding to `50_000_000`, and sequence to `1`.
- Successful `repayDebt(20_000_000)` sets cumulative repayment to `20_000_000`, outstanding to `30_000_000`, and sequence to `2`.
- `opened` is never reset, including after full repayment.

## Mutation and event surface

- External mutations: `openDebt`, `repayDebt` only.
- Events: `DebtOpened`, `DebtRepaid` only.
- `DebtOpened`: 4 topics and 160 bytes of data.
- `DebtRepaid`: 4 topics and 192 bytes of data.
- Deployed bytecode: 1,506 bytes.
- Local artifact code hash: `0x50468dfcb559cc885cbc6d4310d8a4d4c00f6f52d27ee94e0920e36a63e4df6d`.

## Negative behavior

The suite verifies state remains unchanged after unauthorized open/repay, zero amount, repayment before opening, second opening, reopening after full repayment, and repayment greater than outstanding.

The local VM behavior is now complemented by T05 public Sepolia evidence:

- Contract: `0x0c93759f8eC91B348D8C53EA03C1ae78ED543760`
- Deployment transaction: `0x8045ae26416b9d3844834747c34f28743ab423830cc9a08b674385feb02f0355`
- `DebtOpened` transaction: `0xa5c0954a0b148e84d37c68a87fc9d37d77c548f1aed4d522ee0c9009f92042cd`
- Run manifest: `runs/20260906-t05/manifest.json`
