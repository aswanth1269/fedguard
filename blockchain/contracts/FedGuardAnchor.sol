// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FedGuardAnchor
/// @notice Append-only, per-round audit anchors for a FedGuard federation.
///
/// WHAT THIS ANCHORS, AND WHY IT IS NOT JUST THE MODEL HASH
/// --------------------------------------------------------
/// Anchoring only a model hash would be decorative: a checksummed S3 object
/// gives you the same guarantee for none of the cost. This contract anchors
/// three hashes per round, and the second and third are what make the chain
/// load-bearing:
///
///   modelHash       the aggregated global model's weights
///   reputationHash  the cross-round reputation vector over clients
///   decisionHash    the full aggregation decision - who was accepted, who was
///                   rejected, and with what weights
///
/// Anchoring the reputation state and the decision is what makes a flagged
/// bank unable to repudiate ("you never flagged me") and a compromised
/// coordinator unable to rewrite history ("bank C was always trusted"). That
/// is the technical effect the project's third research claim rests on.
///
/// TAMPER-EVIDENCE vs TAMPER-RESISTANCE
/// ------------------------------------
/// The off-chain default (fedguard's ledger/chain.py) is a single-writer hash
/// chain. It is honestly documented as tamper-EVIDENT only: anyone with write
/// access to the file can rewrite the whole thing into a new, internally
/// consistent fabrication. This contract is what upgrades that to
/// tamper-RESISTANT, via two properties a file cannot have:
///
///   1. Only `owner` - the coordinator - can anchor. A participating bank
///      cannot forge entries at all.
///   2. `anchorRound` reverts on a round that is already anchored. Not even
///      the coordinator can revise a past round; it can only append.
///
/// The `prevHash`/`entryHash` link is computed off-chain by the Python client
/// using exactly the same canonicalisation as ledger/chain.py, and stored
/// here. That is deliberate: both backends then share one definition of "the
/// content of this entry", so `verify()` logic is identical whichever backend
/// a run used, and a run can be checked against either.
contract FedGuardAnchor is Ownable {
    struct Anchor {
        uint256 roundNum;
        bytes32 modelHash;
        bytes32 reputationHash;
        bytes32 decisionHash;
        bytes32 entryHash;
        bytes32 prevHash;
        uint256 timestamp;
        uint256 blockNumber;
    }

    /// @dev Keyed by keccak256(configHash). The config hash is a short
    /// human-readable string on the Python side, so it is hashed to get a
    /// fixed-width mapping key while the readable form is kept in the event
    /// and in `runConfigHash` for off-chain indexing.
    mapping(bytes32 => Anchor[]) private _anchors;
    mapping(bytes32 => mapping(uint256 => bool)) private _roundAnchored;
    mapping(bytes32 => string) public runConfigHash;

    /// @dev Every run id ever seen, so a client can enumerate the chain
    /// without having to already know which runs exist.
    bytes32[] private _runIds;

    event RoundAnchored(
        bytes32 indexed runId,
        string configHash,
        uint256 indexed roundNum,
        uint256 index,
        bytes32 modelHash,
        bytes32 reputationHash,
        bytes32 decisionHash,
        bytes32 entryHash,
        bytes32 prevHash
    );

    error RoundAlreadyAnchored(string configHash, uint256 roundNum);
    error EmptyConfigHash();
    error UnknownRun(string configHash);
    error IndexOutOfRange(uint256 index, uint256 length);

    constructor(address coordinator) Ownable(coordinator) {}

    /// @notice Anchor one completed round. Coordinator only, append only.
    /// @dev Reverts rather than overwriting an existing round. An audit trail
    /// whose past entries can be revised by the party being audited is not an
    /// audit trail, and silently accepting a re-anchor would make the ledger
    /// agree with whatever was written last.
    function anchorRound(
        string calldata configHash,
        uint256 roundNum,
        bytes32 modelHash,
        bytes32 reputationHash,
        bytes32 decisionHash,
        bytes32 entryHash,
        bytes32 prevHash
    ) external onlyOwner returns (uint256 index) {
        if (bytes(configHash).length == 0) revert EmptyConfigHash();

        bytes32 runId = keccak256(bytes(configHash));
        if (_roundAnchored[runId][roundNum]) {
            revert RoundAlreadyAnchored(configHash, roundNum);
        }

        // First sighting of this run: record the readable hash and add it to
        // the enumerable set.
        if (_anchors[runId].length == 0) {
            runConfigHash[runId] = configHash;
            _runIds.push(runId);
        }

        index = _anchors[runId].length;
        _anchors[runId].push(
            Anchor({
                roundNum: roundNum,
                modelHash: modelHash,
                reputationHash: reputationHash,
                decisionHash: decisionHash,
                entryHash: entryHash,
                prevHash: prevHash,
                timestamp: block.timestamp,
                blockNumber: block.number
            })
        );
        _roundAnchored[runId][roundNum] = true;

        emit RoundAnchored(
            runId,
            configHash,
            roundNum,
            index,
            modelHash,
            reputationHash,
            decisionHash,
            entryHash,
            prevHash
        );
    }

    // -- views ---------------------------------------------------------------

    function runIdFor(string calldata configHash) public pure returns (bytes32) {
        return keccak256(bytes(configHash));
    }

    function roundCount(string calldata configHash) external view returns (uint256) {
        return _anchors[keccak256(bytes(configHash))].length;
    }

    function isAnchored(string calldata configHash, uint256 roundNum) external view returns (bool) {
        return _roundAnchored[keccak256(bytes(configHash))][roundNum];
    }

    function getAnchor(string calldata configHash, uint256 index)
        external
        view
        returns (Anchor memory)
    {
        bytes32 runId = keccak256(bytes(configHash));
        Anchor[] storage run = _anchors[runId];
        if (run.length == 0) revert UnknownRun(configHash);
        if (index >= run.length) revert IndexOutOfRange(index, run.length);
        return run[index];
    }

    /// @notice Every anchor for one run, in order.
    /// @dev Returns the whole array in one call. Unbounded in principle, but a
    /// run is tens of rounds by construction (configs cap at 20-30), so this
    /// will not hit the gas limit for this project's actual usage. Paginate
    /// via `roundCount` + `getAnchor` if that ever stops being true.
    function getRun(string calldata configHash) external view returns (Anchor[] memory) {
        return _anchors[keccak256(bytes(configHash))];
    }

    function runCount() external view returns (uint256) {
        return _runIds.length;
    }

    function runIdAt(uint256 index) external view returns (bytes32) {
        if (index >= _runIds.length) revert IndexOutOfRange(index, _runIds.length);
        return _runIds[index];
    }
}
