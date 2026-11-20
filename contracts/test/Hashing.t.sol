// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {Field} from "../src/lib/Field.sol";

/// Vectors printed by `nargo test --package vatanta_lib vectors --show-output` (circuits/lib).
contract HashingTest is Test {
    uint256 constant H2_1_2 = 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383;
    uint256 constant OWNER_42 = 0x1fa814db9a154d70a60e405655689d3db54ae3ce3868bbcafb8d0f5fb0e98786;
    uint256 constant PRE_42_7 = 0x0731f7f03e6e9b7a6f9e27dd28c7a65ec6ad8a08927e2295926ffa23c2c2d8b2;
    uint256 constant NOTE_10_42_7 = 0x13deff25e5dca54aea5ff7542990590479ca239153be3481b73206e9e1e4499a;

    function test_hash2_matches_noir() public pure {
        assertEq(Field.hash2(1, 2), H2_1_2);
    }

    function test_owner_matches_noir() public pure {
        assertEq(Field.hash2(1, 42), OWNER_42);
    }

    function test_precommit_matches_noir() public pure {
        assertEq(Field.hash3(2, OWNER_42, 7), PRE_42_7);
    }

    function test_commitment_matches_noir() public pure {
        assertEq(Field.noteCommitment(10e6, PRE_42_7), NOTE_10_42_7);
    }
}
