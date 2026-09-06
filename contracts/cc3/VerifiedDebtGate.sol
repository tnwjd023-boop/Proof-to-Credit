// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

import "../interfaces/INativeQueryVerifier.sol";
import "../interfaces/IEvmDecoder.sol";
import "./SourcePosition.sol";

contract VerifiedDebtGate {
    error WrongSourceChain(uint64 supplied, uint64 expected);
    error InvalidProof();
    error AlreadyProcessed(bytes32 queryId);
    error NoApplicableLog();
    error AlreadyInitialized();
    error InvalidOpening();
    error OutOfOrderSourcePosition();
    error MissingOpening();
    error InvalidSequence(uint64 supplied, uint64 expected);
    error InvalidRepayment();

    event SourceEventApplied(
        bytes32 indexed eventId,
        bytes32 indexed queryId,
        uint64 sourceBlock,
        uint64 txIndex,
        uint64 logIndex,
        bytes32 loanId,
        uint64 sequence,
        uint256 debt,
        uint256 totalRepaid,
        uint64 stateVersion
    );

    bytes32 private constant DEBT_OPENED_SIGNATURE = keccak256(
        "DebtOpened(bytes32,bytes32,address,bytes32,uint64,uint256,uint256,uint64)"
    );
    bytes32 private constant DEBT_REPAID_SIGNATURE = keccak256(
        "DebtRepaid(bytes32,bytes32,address,bytes32,uint64,uint256,uint256,uint256,uint64)"
    );

    INativeQueryVerifier public immutable verifier;
    IEvmDecoder public immutable decoder;
    uint64 public immutable sourceChainKey;
    uint256 public immutable sourceEvmChainId;
    address public immutable sourceEmitter;
    bytes32 public immutable assetId;
    bytes32 public immutable loanId;
    bytes32 public immutable unitId;
    address public immutable borrower;
    address public immutable policyOwner;
    uint256 public immutable initialCreditLimit;

    bool public initialized;
    uint256 public principalOpened;
    uint256 public totalRepaid;
    uint256 public verifiedDebt;
    uint64 public lastSequence;
    uint64 public lastSourceBlock;
    uint64 public lastTxIndex;
    uint64 public lastLogIndex;
    uint64 public lastSourceTimestamp;
    uint64 public lastAdmittedAt;
    uint64 public stateVersion;
    bytes32 public lastEventId;
    mapping(bytes32 => bool) public processedQueries;

    constructor(
        address verifier_,
        address decoder_,
        uint64 sourceChainKey_,
        uint256 sourceEvmChainId_,
        address sourceEmitter_,
        bytes32 assetId_,
        bytes32 loanId_,
        bytes32 unitId_,
        address borrower_,
        address policyOwner_,
        uint256 initialCreditLimit_
    ) {
        verifier = INativeQueryVerifier(verifier_);
        decoder = IEvmDecoder(decoder_);
        sourceChainKey = sourceChainKey_;
        sourceEvmChainId = sourceEvmChainId_;
        sourceEmitter = sourceEmitter_;
        assetId = assetId_;
        loanId = loanId_;
        unitId = unitId_;
        borrower = borrower_;
        policyOwner = policyOwner_;
        initialCreditLimit = initialCreditLimit_;
    }

    function submitSourceTransaction(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        INativeQueryVerifier.MerkleProof calldata merkleProof,
        INativeQueryVerifier.ContinuityProof calldata continuityProof
    ) external returns (uint64 appliedLogCount) {
        if (chainKey != sourceChainKey) revert WrongSourceChain(chainKey, sourceChainKey);
        if (!verifier.verify(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof)) {
            revert InvalidProof();
        }
        uint64 txIndex = verifier.calculateTxIndex(merkleProof);
        bytes32 queryId = keccak256(abi.encode(chainKey, blockHeight, txIndex));
        if (processedQueries[queryId]) revert AlreadyProcessed(queryId);

        IEvmDecoder.ReceiptFields memory receipt = decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert InvalidProof();
        for (uint64 i; i < receipt.receiptLogs.length; ++i) {
            IEvmDecoder.LogEntry memory entry = receipt.receiptLogs[i];
            if (
                entry.address_ != sourceEmitter ||
                entry.topics.length != 4 ||
                (entry.topics[0] != DEBT_OPENED_SIGNATURE && entry.topics[0] != DEBT_REPAID_SIGNATURE)
            ) continue;
            if (
                initialized &&
                !SourcePosition.isAfter(
                    blockHeight,
                    txIndex,
                    i,
                    lastSourceBlock,
                    lastTxIndex,
                    lastLogIndex
                )
            ) revert OutOfOrderSourcePosition();
            if (entry.topics[0] == DEBT_OPENED_SIGNATURE) {
                _applyOpening(queryId, blockHeight, txIndex, i, entry);
            } else {
                _applyRepayment(queryId, blockHeight, txIndex, i, entry);
            }
            appliedLogCount += 1;
        }
        if (appliedLogCount == 0) revert NoApplicableLog();
        processedQueries[queryId] = true;
    }

    function _applyRepayment(
        bytes32 queryId,
        uint64 blockHeight,
        uint64 txIndex,
        uint64 logIndex,
        IEvmDecoder.LogEntry memory entry
    ) private {
        if (!initialized) revert MissingOpening();
        if (
            entry.topics[1] != assetId ||
            entry.topics[2] != loanId ||
            address(uint160(uint256(entry.topics[3]))) != borrower
        ) revert InvalidRepayment();
        (
            bytes32 eventUnitId,
            uint64 sequence,
            uint256 amount,
            uint256 cumulativeRepaid,
            uint256 outstanding,
            uint64 sourceTimestamp
        ) = abi.decode(entry.data, (bytes32, uint64, uint256, uint256, uint256, uint64));
        uint64 expectedSequence = lastSequence + 1;
        if (sequence != expectedSequence) revert InvalidSequence(sequence, expectedSequence);
        if (
            eventUnitId != unitId ||
            amount == 0 ||
            amount > verifiedDebt ||
            cumulativeRepaid != totalRepaid + amount ||
            cumulativeRepaid > principalOpened ||
            outstanding != principalOpened - cumulativeRepaid ||
            outstanding != verifiedDebt - amount ||
            sourceTimestamp < lastSourceTimestamp
        ) revert InvalidRepayment();

        totalRepaid = cumulativeRepaid;
        verifiedDebt = outstanding;
        lastSequence = sequence;
        _recordAppliedPosition(queryId, blockHeight, txIndex, logIndex, sourceTimestamp);
    }

    function _recordAppliedPosition(
        bytes32 queryId,
        uint64 blockHeight,
        uint64 txIndex,
        uint64 logIndex,
        uint64 sourceTimestamp
    ) private {
        bytes32 eventId = keccak256(abi.encode(queryId, logIndex));
        lastSourceBlock = blockHeight;
        lastTxIndex = txIndex;
        lastLogIndex = logIndex;
        lastSourceTimestamp = sourceTimestamp;
        lastAdmittedAt = uint64(block.timestamp);
        stateVersion += 1;
        lastEventId = eventId;
        emit SourceEventApplied(
            eventId, queryId, blockHeight, txIndex, logIndex, loanId,
            lastSequence, verifiedDebt, totalRepaid, stateVersion
        );
    }

    function _applyOpening(
        bytes32 queryId,
        uint64 blockHeight,
        uint64 txIndex,
        uint64 logIndex,
        IEvmDecoder.LogEntry memory entry
    ) private {
        if (initialized) revert AlreadyInitialized();
        if (
            entry.topics[1] != assetId ||
            entry.topics[2] != loanId ||
            address(uint160(uint256(entry.topics[3]))) != borrower
        ) revert InvalidOpening();
        (bytes32 eventUnitId, uint64 sequence, uint256 principal, uint256 outstanding, uint64 sourceTimestamp) =
            abi.decode(entry.data, (bytes32, uint64, uint256, uint256, uint64));
        if (eventUnitId != unitId || sequence != 1 || principal == 0 || outstanding != principal) {
            revert InvalidOpening();
        }

        initialized = true;
        principalOpened = principal;
        verifiedDebt = outstanding;
        lastSequence = sequence;
        _recordAppliedPosition(queryId, blockHeight, txIndex, logIndex, sourceTimestamp);
    }

    function getState()
        external
        view
        returns (
            bool initialized_,
            uint256 principalOpened_,
            uint256 totalRepaid_,
            uint256 verifiedDebt_,
            uint64 lastSequence_,
            uint64 lastSourceBlock_,
            uint64 lastTxIndex_,
            uint64 stateVersion_
        )
    {
        return (
            initialized,
            principalOpened,
            totalRepaid,
            verifiedDebt,
            lastSequence,
            lastSourceBlock,
            lastTxIndex,
            stateVersion
        );
    }
}
