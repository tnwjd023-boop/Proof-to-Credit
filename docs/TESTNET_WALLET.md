# Testnet wallet runbook

## Public identity

- Classification: **TESTNET ONLY**
- Address: `0x122409763443d94060fAc61676d50c0B1006f49F`
- Allowed networks: Ethereum Sepolia (`11155111`) and Creditcoin CC3 Testnet (`102031`) only

The private key is stored in the repository-local, gitignored `.env`. Never paste it into an issue, commit, chat, screenshot, CI variable, or faucet form. Faucets need only the public address above.

## Funding

1. Request Sepolia ETH using a faucet listed by Ethereum.org: <https://ethereum.org/developers/docs/networks/#sepolia>.
2. Join the official Creditcoin Discord and use the `token-faucet` channel as documented at <https://docs.creditcoin.org/wallets/using-testnet-faucet>.
3. Run `/faucet address:0x122409763443d94060fAc61676d50c0B1006f49F` for CC3 Testnet tCTC.
4. Verify both balances before running T05 deployment scripts.

## Regeneration guard

`npm run wallet:create` creates `.env` only when it does not already exist. It refuses to overwrite the current signer or configuration. If the local `.env` is lost, the wallet cannot be recovered from this repository.
