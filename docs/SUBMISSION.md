# Proof-to-Credit — Submission Description

## One-line pitch

Proof-to-Credit uses Attestcoin proof of source transaction-byte inclusion to reconstruct principal for an independent, capacity-bounded Creditcoin policy.

## 100–150 word description

Proof-to-Credit turns loan events decoded from proof-verified source transaction bytes into bounded inputs for an independent destination credit policy. A Sepolia single-draw loan opened 50 `DEMO_USD_6` units and later repaid 20. On Creditcoin CC3 Testnet, Attestcoin's BlockProver verified inclusion of the source transaction bytes in the supported chain path; the application decoded those same bytes, admitted the scoped events, and reconstructed debt from 50 to 30. With a destination-owned limit of 60, a request for 30 changed from REJECT to ALLOW only after the repayment proof was admitted. `commitCredit` then atomically recorded a local commitment of 30, reducing headroom to zero and causing a request for 1 to be rejected. The prototype demonstrates proof-to-state-to-policy-to-capacity, not a new lending formula or creditworthiness proof. It does not transfer funds or verify collateral, gold, ownership, reserves, complete history, or aggregate exposure.

## Demo in four transitions

| Transition | Verified or reconstructed fact | Independent destination result |
|---|---|---|
| Opening proof | `verifiedDebt = 50` | request `30` with limit `60` → **REJECT**, headroom `10` |
| Repayment proof | repayment `20`; `verifiedDebt = 30` | request `30` with limit `60` → **ALLOW**, headroom `30` |
| Atomic commitment | fact remains `verifiedDebt = 30` | `commitCredit(30)` → `committedCredit = 30`, headroom `0` |
| Capacity consumed | debt `30` plus commitment `30` | next request `1` → **REJECT** |

`REJECT` and `ALLOW` are historical, reproducible `evaluate` view results, not persistent rejection or approval records. The successful `commitCredit` transaction is the capacity-changing record; it transfers no funds.

## Public evidence

| Evidence | Network | Transaction / record |
|---|---|---|
| `DebtOpened(50)` | Ethereum Sepolia | `0xa5c0954a0b148e84d37c68a87fc9d37d77c548f1aed4d522ee0c9009f92042cd` |
| `DebtRepaid(20)` | Ethereum Sepolia | `0x326c666d0208e6f1625396a559cb78bb4e7783c56eda52c11643e7339cba0687` |
| Opening proof admitted | Creditcoin CC3 Testnet | `0xf6587f667a069b272c9650e6dfdaf577c0b020ece3c200b8da85e2e5df890ebd` |
| Repayment proof admitted | Creditcoin CC3 Testnet | `0xe13a4974cb8c79b5c81163081991b3a6e0823f4c4b382f0ef8ae8ab25e8dbcc0` |
| `commitCredit(30)` | Creditcoin CC3 Testnet | `0xcf3d79a7d50c87dfc860bd067da91357c8bc695b5b48fb035cefa4571e3dbb20` |
| Final state and decision snapshots | Canonical manifest | [`runs/20260906-t05/manifest.json`](../runs/20260906-t05/manifest.json) |

The canonical destination contract is `0xC97b7EA6de5fc4Cb39D7Fc52881B3d98f4b68147`. Evidence boundaries and negative claims are maintained in [`docs/CLAIMS.md`](CLAIMS.md) and [`docs/TEST_MATRIX.md`](TEST_MATRIX.md).
