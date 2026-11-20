// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/ERC20.sol";
import {IHonkVerifier} from "../../src/interfaces/IHonkVerifier.sol";
import {IERC20SendAndCallReceiver, SendTokensInput, SendAndCallInput} from "../../src/interfaces/IICTT.sol";

/// Unit-test only: accepts every proof. Real-proof tests live in RealProofs.t.sol.
contract AcceptAllVerifier is IHonkVerifier {
    bool public accept = true;

    function set(bool a) external {
        accept = a;
    }

    function verify(bytes calldata, bytes32[] calldata) external view returns (bool) {
        return accept;
    }
}

/// Behaves like ICTT ERC20TokenRemote for the pool: ERC20 + `send` burns via self-allowance,
/// `deliver` mimics an incoming `sendAndCall` (mint → approve → receiveTokens → fallback).
contract MockTokenRemote is ERC20 {
    struct Sent {
        bytes32 dest;
        address destTransferrer;
        address recipient;
        uint256 amount;
        uint256 requiredGas;
        address multiHopFallback;
    }

    Sent[] public sent;

    constructor() ERC20("Bridged USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function send(SendTokensInput calldata input, uint256 amount) external {
        _spendAllowance(msg.sender, address(this), amount);
        _burn(msg.sender, amount);
        sent.push(Sent(input.destinationBlockchainID, input.destinationTokenTransferrerAddress, input.recipient, amount, input.requiredGasLimit, input.multiHopFallback));
    }

    function sentCount() external view returns (uint256) {
        return sent.length;
    }

    function deliver(
        bytes32 source,
        address originTransferrer,
        address originSender,
        address recipientContract,
        uint256 amount,
        bytes calldata payload,
        address fallbackRecipient
    ) external returns (bool ok) {
        _mint(address(this), amount);
        _approve(address(this), recipientContract, amount);
        (ok,) = recipientContract.call(
            abi.encodeCall(
                IERC20SendAndCallReceiver.receiveTokens, (source, originTransferrer, originSender, address(this), amount, payload)
            )
        );
        uint256 left = allowance(address(this), recipientContract);
        _approve(address(this), recipientContract, 0);
        if (left > 0) _transfer(address(this), fallbackRecipient, left);
    }
}

/// Records DepositRouter's sendAndCall calls (C-Chain side unit tests).
contract MockTokenHome {
    struct Call {
        bytes32 dest;
        address destTransferrer;
        address recipientContract;
        bytes payload;
        uint256 amount;
        address fallbackRecipient;
    }

    ERC20 public immutable token;
    Call[] public calls;

    constructor(ERC20 token_) {
        token = token_;
    }

    function sendAndCall(SendAndCallInput calldata input, uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        calls.push(Call(input.destinationBlockchainID, input.destinationTokenTransferrerAddress, input.recipientContract, input.recipientPayload, amount, input.fallbackRecipient));
    }

    function callCount() external view returns (uint256) {
        return calls.length;
    }
}
