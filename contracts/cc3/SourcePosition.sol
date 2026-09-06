// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

library SourcePosition {
    function isAfter(
        uint64 blockNumber,
        uint64 txIndex,
        uint64 logIndex,
        uint64 previousBlock,
        uint64 previousTxIndex,
        uint64 previousLogIndex
    ) internal pure returns (bool) {
        if (blockNumber != previousBlock) return blockNumber > previousBlock;
        if (txIndex != previousTxIndex) return txIndex > previousTxIndex;
        return logIndex > previousLogIndex;
    }
}
