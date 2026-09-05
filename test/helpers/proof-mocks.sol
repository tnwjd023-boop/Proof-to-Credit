// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

contract TestOnlyVerifierMock {
    bool private immutable verdict;

    constructor(bool verdict_) {
        verdict = verdict_;
    }

    function verify(bytes calldata) external view returns (bool) {
        return verdict;
    }
}
