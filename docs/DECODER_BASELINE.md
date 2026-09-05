# T03 decoder and local VM baseline

## Result

**VERIFIED — real-data local decoding.** The vendored `EvmV1Decoder` decoded the actual Attestcoin `txBytes` fixture inside EthereumJS VM. The decoded receipt was compared with a fresh Ethereum Sepolia RPC receipt.

This proves local encoding/decoding compatibility. The local VM does not perform BlockProver cryptographic verification; T02 is the separate evidence for that runtime layer.

## Compiler

| Field | Value |
|---|---|
| solc | `0.8.36+commit.8a079791.Emscripten.clang` |
| viaIR | `true` |
| EVM target | `paris` |
| optimizer | enabled, runs `200` |
| deployed decoder size | `10,272` bytes |
| deployed decoder keccak256 | `0x6af1caad44e16d0090d318227b4a6feedc490e6c63399dcc642018d9968dc38d` |

The decoder is vendored from `@gluwa/usc-contracts@0.1.2`, with its original `SPDX-License-Identifier: MIT`. After CRLF/LF and trailing-newline normalization, the vendored content equals the installed package source.

## Fixture

| Field | Value |
|---|---|
| Source transaction | `0x58024bb55f0357e3e8fdb0791e0e8248c9ac7c3680b9634d1f6209bb8046d40c` |
| Block / transaction index | `11642790` / `17` |
| Type / status | `2` / `1` |
| Gas used | `50,636` |
| Receipt logs | `2` |
| Topics per log | `3`, `1` |
| Data bytes per log | `32`, `32` |

The test explicitly compares every log address, topic, and data byte with `eth_getTransactionReceipt`. The fixture is stored at `test/fixtures/sepolia-proof.json` and contains no secret.

## Negative fixtures

- Unsupported transaction type `5`: rejected with `EvmV1Decoder: Invalid transaction type`/EVM revert.
- Malformed bytes `0x1234`: rejected by ABI decoding/EVM execution.
- `TestOnlyVerifierMock` is under `test/helpers/` and is compiled only for local tests. Its result is never described as an actual proof verdict.
