// SPDX-License-Identifier: MIT
pragma solidity ^0.8.36;

contract SingleDrawLoanMock {
    error NotBorrower(address caller);
    error ZeroAmount();
    error AlreadyOpened();
    error MissingOpening();
    error OverRepayment(uint256 amount, uint256 outstanding);

    event DebtOpened(
        bytes32 indexed assetId,
        bytes32 indexed loanId,
        address indexed borrower,
        bytes32 unitId,
        uint64 sequence,
        uint256 principal,
        uint256 outstanding,
        uint64 sourceTimestamp
    );

    event DebtRepaid(
        bytes32 indexed assetId,
        bytes32 indexed loanId,
        address indexed borrower,
        bytes32 unitId,
        uint64 sequence,
        uint256 amount,
        uint256 cumulativeRepaid,
        uint256 outstanding,
        uint64 sourceTimestamp
    );

    bytes32 public immutable assetId;
    bytes32 public immutable loanId;
    bytes32 public immutable unitId;
    address public immutable borrower;

    bool public opened;
    uint256 public principalOpened;
    uint256 public totalRepaid;
    uint256 public outstanding;
    uint64 public sequence;

    modifier onlyBorrower() {
        if (msg.sender != borrower) revert NotBorrower(msg.sender);
        _;
    }

    constructor(bytes32 assetId_, bytes32 unitId_, address borrower_) {
        assetId = assetId_;
        unitId = unitId_;
        borrower = borrower_;
        loanId = keccak256(abi.encode(block.chainid, address(this), assetId_, borrower_, uint256(1)));
    }

    function openDebt(uint256 principal) external onlyBorrower {
        if (opened) revert AlreadyOpened();
        if (principal == 0) revert ZeroAmount();

        opened = true;
        principalOpened = principal;
        outstanding = principal;
        sequence = 1;

        emit DebtOpened(
            assetId,
            loanId,
            borrower,
            unitId,
            sequence,
            principalOpened,
            outstanding,
            uint64(block.timestamp)
        );
    }

    function repayDebt(uint256 amount) external onlyBorrower {
        if (!opened) revert MissingOpening();
        if (amount == 0) revert ZeroAmount();
        if (amount > outstanding) revert OverRepayment(amount, outstanding);

        totalRepaid += amount;
        outstanding = principalOpened - totalRepaid;
        sequence += 1;

        emit DebtRepaid(
            assetId,
            loanId,
            borrower,
            unitId,
            sequence,
            amount,
            totalRepaid,
            outstanding,
            uint64(block.timestamp)
        );
    }

    function getLoanState()
        external
        view
        returns (
            bool opened_,
            uint256 principalOpened_,
            uint256 totalRepaid_,
            uint256 outstanding_,
            uint64 sequence_
        )
    {
        return (opened, principalOpened, totalRepaid, outstanding, sequence);
    }
}
