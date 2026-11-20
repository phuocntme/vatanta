// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Field} from "./Field.sol";

/// Incremental Poseidon2 Merkle tree, depth 32, with batched insertion (n + 32 hashes for n
/// consecutive leaves) and a time-based root window (SPEC.md §4.5).
abstract contract MerkleTree {
    uint256 public constant DEPTH = 32;
    uint256 public constant ROOT_WINDOW = 48 hours;

    uint256[DEPTH] public zeros;
    uint256[DEPTH] public filledSubtrees;
    uint256 public currentRoot;
    uint32 public nextIndex;
    /// root => last timestamp at which it is accepted (type(uint256).max while current)
    mapping(uint256 => uint256) public rootExpiry;

    event RootUpdated(uint256 indexed root, uint32 nextIndex);

    error TreeFull();
    error NotAFieldElement();

    constructor() {
        uint256 z = 0;
        for (uint256 i = 0; i < DEPTH; i++) {
            zeros[i] = z;
            filledSubtrees[i] = z;
            z = Field.hash2(z, z);
        }
        currentRoot = z;
        rootExpiry[z] = type(uint256).max;
    }

    function isKnownRoot(uint256 root) public view returns (bool) {
        return root != 0 && rootExpiry[root] >= block.timestamp;
    }

    /// Inserts `leaves` at consecutive indices; returns the index of the first one.
    function _insert(uint256[] memory leaves) internal returns (uint32 start) {
        uint256 n = leaves.length;
        start = nextIndex;
        if (n == 0) return start;
        if (uint256(start) + n > (1 << DEPTH)) revert TreeFull();
        for (uint256 i = 0; i < n; i++) {
            if (leaves[i] >= Field.P) revert NotAFieldElement();
        }

        uint256 s = start;
        uint256 e = uint256(start) + n - 1;
        uint256[] memory level = leaves;
        for (uint256 d = 0; d < DEPTH; d++) {
            uint256 ps = s >> 1;
            uint256 pe = e >> 1;
            uint256[] memory up = new uint256[](pe - ps + 1);
            // Left sibling of node `s` when `s` is odd: saved by an earlier insert. Read it
            // before this level's filledSubtrees slot is overwritten below.
            uint256 left0 = filledSubtrees[d];
            uint256 zero = zeros[d];
            for (uint256 p = ps; p <= pe; p++) {
                uint256 li = p << 1;
                uint256 l = li < s ? left0 : level[li - s];
                uint256 r = li + 1 > e ? zero : level[li + 1 - s];
                up[p - ps] = Field.hash2(l, r);
            }
            // Save the left-most node a future insert (starting at e+1) may need as sibling.
            if (e & 1 == 0) {
                filledSubtrees[d] = level[e - s];
            } else if (e > s) {
                filledSubtrees[d] = level[e - 1 - s];
            }
            level = up;
            s = ps;
            e = pe;
        }
        uint256 root = level[0];
        rootExpiry[currentRoot] = block.timestamp + ROOT_WINDOW;
        currentRoot = root;
        rootExpiry[root] = type(uint256).max;
        nextIndex = uint32(uint256(start) + n);
        emit RootUpdated(root, nextIndex);
    }
}
