// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

interface IEvmDecoder {
    struct LogEntry {
        address address_;
        bytes32[] topics;
        bytes data;
    }

    struct ReceiptFields {
        uint8 receiptStatus;
        uint64 receiptGasUsed;
        LogEntry[] receiptLogs;
        bytes receiptLogsBloom;
    }

    function getTransactionType(bytes memory encodedTx) external pure returns (uint8 txType);
    function isValidTransactionType(uint8 txType) external pure returns (bool);
    function decodeReceiptFields(bytes memory encodedTx) external pure returns (ReceiptFields memory receipt);
}
