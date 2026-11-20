// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {LibPoseidon2Yul} from "poseidon2-evm/src/bn254/yul/LibPoseidon2Yul.sol";

/// Hashing shared with the circuits (SPEC.md §4.1). `H(a,b,..)` = Noir `Poseidon2::hash([a,b,..], n)`.
library Field {
    uint256 internal constant P = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
    uint256 internal constant DOM_PRE = 2;
    uint256 internal constant DOM_NOTE = 3;

    function hash2(uint256 a, uint256 b) internal pure returns (uint256) {
        return LibPoseidon2Yul.hash_2(a, b);
    }

    function hash3(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return LibPoseidon2Yul.hash_3(a, b, c);
    }

    /// commitment = H(3, amount, precommit)
    function noteCommitment(uint256 amount, uint256 precommit) internal pure returns (uint256) {
        return hash3(DOM_NOTE, amount, precommit);
    }

    /// keccak-to-field for ext data binding.
    function toField(bytes32 h) internal pure returns (uint256) {
        return uint256(h) % P;
    }
}
