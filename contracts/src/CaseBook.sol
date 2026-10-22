// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Records commitments and Chog appearances. Holds no funds and cannot move NFTs.
contract CaseBook {
    error NotOwner();
    error InvalidOwner();
    error InvalidCase();
    error AlreadyOpened();
    error NotOpened();
    error AlreadyClosed();
    error TooEarly();
    error WrongKey();
    error InvalidCast();
    error CastAlreadyRecorded();
    error InvalidSolves();
    error SolveAlreadyRecorded();
    address public owner;
    address public pendingOwner;
    struct Case { bytes32 answerHash; uint64 opensAt; uint64 closesAt; bool closed; bool castRecorded; }
    mapping(bytes32 => Case) private cases;
    /// @dev One bit per Chog token id (1..1969) per case, so each token's result is recorded once.
    mapping(bytes32 => uint256[8]) private solved;
    event CaseOpened(bytes32 indexed caseId, bytes32 answerHash, uint64 opensAt, uint64 closesAt);
    event CaseClosed(bytes32 indexed caseId, bytes answerKey);
    event CastRecorded(bytes32 indexed caseId, uint256 indexed tokenId, uint8 flags);
    event SolveRecorded(bytes32 indexed caseId, uint16 indexed tokenId, uint8 result);
    event OwnershipProposed(address indexed nextOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidOwner();
        owner = initialOwner;
    }
    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    function proposeOwner(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidOwner();
        pendingOwner = nextOwner;
        emit OwnershipProposed(nextOwner);
    }
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotOwner();
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
    }
    function openCase(bytes32 caseId, bytes32 answerHash, uint64 opensAt, uint64 closesAt) external onlyOwner {
        if (caseId == bytes32(0) || answerHash == bytes32(0) || closesAt <= opensAt || closesAt <= block.timestamp) revert InvalidCase();
        if (cases[caseId].answerHash != bytes32(0)) revert AlreadyOpened();
        cases[caseId] = Case(answerHash, opensAt, closesAt, false, false);
        emit CaseOpened(caseId, answerHash, opensAt, closesAt);
    }
    function closeCase(bytes32 caseId, bytes calldata answerKeyCanonical) external onlyOwner {
        Case storage item = cases[caseId];
        if (item.answerHash == bytes32(0)) revert NotOpened();
        if (item.closed) revert AlreadyClosed();
        if (block.timestamp < item.closesAt) revert TooEarly();
        if (keccak256(answerKeyCanonical) != item.answerHash) revert WrongKey();
        item.closed = true;
        emit CaseClosed(caseId, answerKeyCanonical);
    }
    /// @notice Flags: bit 0 in the cast, bit 1 subject, bit 2 liar. Weekday casts have three Chogs and one liar;
    /// weekend casts four Chogs and two liars; alternate plans may name a third liar.
    function recordCast(bytes32 caseId, uint256[] calldata tokenIds, uint8[] calldata flags) external onlyOwner {
        Case storage item = cases[caseId];
        if (!item.closed) revert NotOpened();
        if (item.castRecorded) revert CastAlreadyRecorded();
        if (tokenIds.length < 3 || tokenIds.length > 4 || flags.length != tokenIds.length) revert InvalidCast();
        uint256 subjects;
        uint256 liars;
        for (uint256 i; i < tokenIds.length; i++) {
            if (tokenIds[i] == 0 || tokenIds[i] > 1969 || flags[i] == 0 || flags[i] > 7 || (flags[i] & 1) == 0) revert InvalidCast();
            for (uint256 j; j < i; j++) if (tokenIds[i] == tokenIds[j]) revert InvalidCast();
            if ((flags[i] & 2) != 0) subjects++;
            if ((flags[i] & 4) != 0) liars++;
        }
        if (subjects != 1 || liars == 0 || liars > 3) revert InvalidCast();
        item.castRecorded = true;
        for (uint256 i; i < tokenIds.length; i++) emit CastRecorded(caseId, tokenIds[i], flags[i]);
    }
    /// @notice Records detective results after close, in chunks of at most 200 tokens.
    /// Result bits: 0 solved, 1 perfect, 2 lie A, 3 lie B, 4 lie C, 5-6 grade (A=3 .. D=0); bit 7 must be clear.
    function recordSolves(bytes32 caseId, uint16[] calldata tokenIds, uint8[] calldata results) external onlyOwner {
        Case storage item = cases[caseId];
        if (!item.closed) revert NotOpened();
        if (tokenIds.length == 0 || tokenIds.length > 200 || results.length != tokenIds.length) revert InvalidSolves();
        uint256[8] storage seen = solved[caseId];
        for (uint256 i; i < tokenIds.length; i++) {
            uint16 tokenId = tokenIds[i];
            if (tokenId == 0 || tokenId > 1969 || results[i] > 127) revert InvalidSolves();
            uint256 bit = uint256(1) << (tokenId & 255);
            if (seen[tokenId >> 8] & bit != 0) revert SolveAlreadyRecorded();
            seen[tokenId >> 8] |= bit;
            emit SolveRecorded(caseId, tokenId, results[i]);
        }
    }
    function solveRecorded(bytes32 caseId, uint16 tokenId) external view returns (bool) {
        if (tokenId == 0 || tokenId > 1969) return false;
        return solved[caseId][tokenId >> 8] & (uint256(1) << (tokenId & 255)) != 0;
    }
    function caseOf(bytes32 caseId) external view returns (bytes32 answerHash, bool closed) {
        Case storage item = cases[caseId];
        return (item.answerHash, item.closed);
    }
    function caseTimes(bytes32 caseId) external view returns (uint64 opensAt, uint64 closesAt) {
        Case storage item = cases[caseId];
        return (item.opensAt, item.closesAt);
    }
}
