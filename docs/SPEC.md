# Proof-to-Credit — fixed MVP scope

Status: **DESIGN CHOICE**, approved by the supplied execution plan.

Proof-to-Credit turns Attestcoin-verified events from one single-draw mock loan on Sepolia into loan-scoped, event-derived principal on Creditcoin CC3 Testnet. A destination-owned policy will later consume that principal together with local committed credit. T01–T02 are read-only and do not deploy contracts or send transactions.

Fixed identities:

- Source: Ethereum Sepolia, EVM chain ID `11155111`.
- Destination: Creditcoin CC3 Testnet, EVM chain ID `102031`.
- Attestcoin source identifier: Sepolia `chainKey=1`; it is not an EVM chain ID.
- BlockProver: `0x0000000000000000000000000000000000000FD2`.
- ChainInfo: `0x0000000000000000000000000000000000000FD3`.
- Unit: `DEMO_USD_6`; source venue/loan/borrower are each singular.
- Compiler baseline for T03: Solidity `0.8.36`, `viaIR=true`, optimizer runs `200`, `evmVersion=paris`.

Out of scope: real lending/fund transfer, gold reserves or rights, collateral valuation, interest, additional draws, reopening, upgrades, aggregate exposure, mainnet writes, and KGLD production integration.

Single-draw is a safety constraint: delayed repayment evidence can overstate principal, while an unseen new draw must never cause principal to be understated.
