// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {MerkleTree} from "../src/lib/MerkleTree.sol";
import {Field} from "../src/lib/Field.sol";

contract TreeHarness is MerkleTree {
    function insert(uint256[] memory leaves) external returns (uint32) {
        return _insert(leaves);
    }
}

contract MerkleTreeTest is Test {
    TreeHarness t;

    function setUp() public {
        t = new TreeHarness();
    }

    /// Reference: full recomputation from all leaves (sparse, zero padded).
    function _refRoot(uint256[] memory leaves) internal view returns (uint256) {
        uint256[] memory level = leaves;
        for (uint256 d = 0; d < 32; d++) {
            uint256 n = (level.length + 1) / 2;
            if (n == 0) n = 1;
            uint256[] memory up = new uint256[](n);
            for (uint256 i = 0; i < n; i++) {
                uint256 l = 2 * i < level.length ? level[2 * i] : t.zeros(d);
                uint256 r = 2 * i + 1 < level.length ? level[2 * i + 1] : t.zeros(d);
                up[i] = Field.hash2(l, r);
            }
            level = up;
        }
        return level[0];
    }

    function test_empty_root() public view {
        uint256[] memory none = new uint256[](0);
        assertEq(t.currentRoot(), _refRoot(none));
        assertTrue(t.isKnownRoot(t.currentRoot()));
    }

    function testFuzz_batched_insert_matches_reference(uint256 seed, uint8[6] memory sizes) public {
        uint256 total;
        uint256[] memory all = new uint256[](0);
        for (uint256 b = 0; b < sizes.length; b++) {
            uint256 n = uint256(sizes[b]) % 9; // batches of 0..8 leaves
            uint256[] memory batch = new uint256[](n);
            for (uint256 i = 0; i < n; i++) {
                batch[i] = uint256(keccak256(abi.encode(seed, total + i))) % Field.P;
            }
            uint32 start = t.insert(batch);
            assertEq(start, total);
            // append
            uint256[] memory next = new uint256[](all.length + n);
            for (uint256 i = 0; i < all.length; i++) next[i] = all[i];
            for (uint256 i = 0; i < n; i++) next[all.length + i] = batch[i];
            all = next;
            total += n;
            assertEq(t.currentRoot(), _refRoot(all), "root mismatch");
        }
        assertEq(t.nextIndex(), total);
    }

    function test_root_window() public {
        uint256 r0 = t.currentRoot();
        uint256[] memory one = new uint256[](1);
        one[0] = 5;
        t.insert(one);
        assertTrue(t.isKnownRoot(r0), "old root valid inside window");
        vm.warp(block.timestamp + 48 hours);
        assertTrue(t.isKnownRoot(r0), "valid at the edge");
        vm.warp(block.timestamp + 1);
        assertFalse(t.isKnownRoot(r0), "expired after 48h");
        assertTrue(t.isKnownRoot(t.currentRoot()), "current root never expires");
        assertFalse(t.isKnownRoot(0));
    }

    function test_rejects_non_field_leaf() public {
        uint256[] memory one = new uint256[](1);
        one[0] = Field.P;
        vm.expectRevert(MerkleTree.NotAFieldElement.selector);
        t.insert(one);
    }

    function test_batch_gas() public {
        uint256[] memory one = new uint256[](1);
        one[0] = 1;
        uint256 g = gasleft();
        t.insert(one);
        emit log_named_uint("gas: insert 1 leaf", g - gasleft());
        uint256[] memory many = new uint256[](13);
        for (uint256 i = 0; i < 13; i++) many[i] = i + 2;
        g = gasleft();
        t.insert(many);
        emit log_named_uint("gas: insert 13 leaves (batched)", g - gasleft());
    }
}
