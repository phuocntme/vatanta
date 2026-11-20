// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// Interface implemented by every verifier generated with `bb write_solidity_verifier -t evm`.
interface IHonkVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}
