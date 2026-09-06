# T07 destination baseline

## Public deployments

- Network: Creditcoin CC3 Testnet, EVM chain ID `102031`
- BlockProver: `0x0000000000000000000000000000000000000FD2`
- Decoder: `0x0c93759f8eC91B348D8C53EA03C1ae78ED543760`
- Decoder deployment transaction: `0x8eb7f7b96e5165c799488586ba4dd793c06b834fdeee8b977e01b2396f3370d5`
- Decoder code hash: `0x6af1caad44e16d0090d318227b4a6feedc490e6c63399dcc642018d9968dc38d`
- VerifiedDebtGate: `0xf2BBE3B025Cc5733fD821D4E6BbE2ba0Cee714Fa`
- Gate deployment transaction: `0xe1aafce1b613e31634d4df8b4bd0fad1ae4bef83a208133a9228ed58db7ed168`
- Gate code hash: `0x93cd0be4bcd201e5a152c91f5341fcbf4411f71e1741b9f60bc2b74621828802`

## First proof application

- Submission transaction: `0xd3ca305c5dc56048f6b15de1b4f3247d117c34ff72fe07be3d6e17ed870dc5d9`
- Receipt status: `1`, CC3 block `5437680`
- Result: initialized, principal and verified debt `50,000,000`, repayment `0`, sequence `1`, state version `1`
- Source position: Sepolia block `11643709`, transaction index `80`

The admission path fixes verifier, decoder, source chain key, source emitter, asset, loan, unit, borrower, policy owner, and initial limit in constructor immutables. The write path has no administrative verifier replacement or direct debt setter.

## Negative controls

After the successful write, read-only calls rejected the same query (`AlreadyProcessed`), wrong source chain (`WrongSourceChain`), and a mutated Merkle root. Local VM tests additionally cover a verifier false result and an otherwise valid event from a non-allowlisted emitter.
