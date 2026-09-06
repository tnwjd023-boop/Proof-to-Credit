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

T08 adds strict `(blockHeight, txIndex, logIndex)` ordering and binds query/event IDs to the verifier-derived transaction index and decoded receipt log index. These changes are locally verified source for the next deployment; the T07 address above remains the immutable T07 build and is not claimed to contain later code.

## T09 repayment deployment

- Decoder: `0x499651Aa184D1c43bD2C52E00831E30fE95Cd8c9`
- VerifiedDebtGate: `0x9c3b41eecAB34ab5089675C1a5Ab38C43f4E7A51`
- Opening submission: `0x3f1906482b0775641b9c384ea04ce3f369a462b73bf05b512089c92728b1bbf8`
- Repayment submission: `0x56c78561186d8deb5cc7d96a19a91026e73e1902f1f0647953ca70be15fa28f1`
- Final verified state: principal `50,000,000`, repaid `20,000,000`, debt `30,000,000`, sequence/state version `2`

This T09 deployment includes the T08 ordering rules and T09 repayment reconstruction. Earlier deployment addresses remain immutable historical evidence and are not aliases for this contract.

## T12 final demo deployment

- Decoder: `0x8006e5fdE6AC19A86D8bAe018191e2b12a3eB01E`
- VerifiedDebtGate: `0xC97b7EA6de5fc4Cb39D7Fc52881B3d98f4b68147`
- Gate deployment transaction: `0x35f06896f8f5e4f66132f50826da2b98bbbea41eda46f06e15fb6a75b7584bae`
- Opening application: `0xf6587f667a069b272c9650e6dfdaf577c0b020ece3c200b8da85e2e5df890ebd`
- Repayment application: `0xe13a4974cb8c79b5c81163081991b3a6e0823f4c4b382f0ef8ae8ab25e8dbcc0`
- Credit commitment: `0xcf3d79a7d50c87dfc860bd067da91357c8bc695b5b48fb035cefa4571e3dbb20`
- Final state: verified debt30, committed credit30, limit60, headroom0, state version3, policy version1

This is the canonical T12 demo instance. Exact code hashes, blocks, decisions, and historical state hashes are in `runs/20260906-t05/manifest.json`. The enforced source identifier is Attestcoin `chainKey=1`; `sourceEvmChainId` is descriptive and is not decoded during admission. T12 REJECT evidence is a historical `evaluate` result, not a persistent rejection transaction.
