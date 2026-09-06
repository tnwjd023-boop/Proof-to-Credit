// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "../../contracts/interfaces/INativeQueryVerifier.sol";

contract TestOnlyVerifierMock {
    bool private immutable verdict;

    constructor(bool verdict_) {
        verdict = verdict_;
    }

    function verify(
        uint64,
        uint64,
        bytes calldata,
        INativeQueryVerifier.MerkleProof calldata,
        INativeQueryVerifier.ContinuityProof calldata
    ) external view returns (bool) {
        return verdict;
    }

    function calculateTxIndex(INativeQueryVerifier.MerkleProof calldata) external pure returns (uint64) {
        return 80;
    }
}
