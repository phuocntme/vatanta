// SPDX-License-Identifier: LicenseRef-Ecosystem
// Copyright (c) Ava Labs, Inc. All rights reserved.
// Derived from ava-labs/icm-contracts v1.0.9 (contracts/ictt/interfaces) under the Ava Labs Ecosystem License.
pragma solidity ^0.8.25;

// Minimal, ABI-identical copies of the ICTT v1.0.9 types we use
// (ava-labs/icm-contracts contracts/ictt/interfaces). Kept local so our contracts do not inherit
// ICTT's exact `pragma solidity 0.8.25` and can share a compilation unit with the bb verifiers.

struct SendTokensInput {
    bytes32 destinationBlockchainID;
    address destinationTokenTransferrerAddress;
    address recipient;
    address primaryFeeTokenAddress;
    uint256 primaryFee;
    uint256 secondaryFee;
    uint256 requiredGasLimit;
    address multiHopFallback;
}

struct SendAndCallInput {
    bytes32 destinationBlockchainID;
    address destinationTokenTransferrerAddress;
    address recipientContract;
    bytes recipientPayload;
    uint256 requiredGasLimit;
    uint256 recipientGasLimit;
    address multiHopFallback;
    address fallbackRecipient;
    address primaryFeeTokenAddress;
    uint256 primaryFee;
    uint256 secondaryFee;
}

interface IERC20TokenTransferrer {
    function send(SendTokensInput calldata input, uint256 amount) external;
    function sendAndCall(SendAndCallInput calldata input, uint256 amount) external;
}

interface IERC20SendAndCallReceiver {
    function receiveTokens(
        bytes32 sourceBlockchainID,
        address originTokenTransferrerAddress,
        address originSenderAddress,
        address token,
        uint256 amount,
        bytes calldata payload
    ) external;
}
