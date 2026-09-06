# Claims register

| Claim | Level | Evidence / limitation |
|---|---|---|
| CC3 Testnet uses EVM chain ID `102031` | VERIFIED (official documentation) | Creditcoin testnet environment page; runtime check is part of `check-env`. |
| Sepolia is Attestcoin `chainKey=1` | VERIFIED | Live Proof Builder and BlockProver accepted the chain mapping in T02. |
| BlockProver and ChainInfo are at `0x...0FD2` and `0x...0FD3` | VERIFIED (official documentation) | Creditcoin USC migration guide; live call is T02 evidence. |
| Proof verification through `eth_call` is a real runtime verdict | VERIFIED | T02 normal proof returned true and two tampered proofs reverted. It does not write state and is not application E2E evidence. |
| Proof-to-Credit integrates with KGLD | FALSE / OUT OF SCOPE | KGLD is an industry reference only. |
| The prototype verifies physical gold, ownership, collateral rights, or actual transfers | FALSE / OUT OF SCOPE | Explicitly not claimed. |
| The state is complete or always latest | FALSE / OUT OF SCOPE | It is an event-derived prefix for one single-draw loan. |
| The policy uses proof-derived debt in its limit calculation | VERIFIED (local T10) | `evaluate` combines verified debt, destination commitments, and the destination-owned limit; a replacement testnet deployment is deferred until the complete policy/commit flow. |
| The policy derives gold value or collateral rights | FALSE / OUT OF SCOPE | Gold quantity and price are not policy inputs; `assetId` is a demo reference label only. |
