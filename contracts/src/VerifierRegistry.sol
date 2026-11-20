// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IHonkVerifier} from "./interfaces/IHonkVerifier.sol";

/// Verification-key hash → verifier contract. Entries are write-once, so a registered circuit can
/// never be swapped under users. This is the hook for third-party circuits (SPEC.md §5).
contract VerifierRegistry {
    address public owner;
    mapping(bytes32 => IHonkVerifier) public verifierOf;
    mapping(bytes32 => string) public nameOf;

    event VerifierRegistered(bytes32 indexed vkHash, address verifier, string name);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error AlreadyRegistered();
    error UnknownVerifier();
    error ZeroAddress();

    constructor(address owner_) {
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function register(bytes32 vkHash, IHonkVerifier verifier, string calldata name) external {
        if (msg.sender != owner) revert NotOwner();
        if (address(verifier) == address(0)) revert ZeroAddress();
        if (address(verifierOf[vkHash]) != address(0)) revert AlreadyRegistered();
        verifierOf[vkHash] = verifier;
        nameOf[vkHash] = name;
        emit VerifierRegistered(vkHash, address(verifier), name);
    }

    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotOwner();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    function verify(bytes32 vkHash, bytes calldata proof, bytes32[] calldata publicInputs)
        external
        view
        returns (bool)
    {
        IHonkVerifier v = verifierOf[vkHash];
        if (address(v) == address(0)) revert UnknownVerifier();
        return v.verify(proof, publicInputs);
    }
}
