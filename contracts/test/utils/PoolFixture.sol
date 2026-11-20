// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {ShieldedPool} from "../../src/ShieldedPool.sol";
import {VerifierRegistry} from "../../src/VerifierRegistry.sol";
import {IERC20Like} from "../../src/interfaces/IERC20Like.sol";
import {IHonkVerifier} from "../../src/interfaces/IHonkVerifier.sol";
import {Field} from "../../src/lib/Field.sol";
import {AcceptAllVerifier, MockTokenRemote} from "./Mocks.sol";

abstract contract PoolFixture is Test {
    bytes32 constant HOME_ID = bytes32(uint256(0xC0C0));
    address constant TOKEN_HOME = address(0x40E1);
    address constant ROUTER = address(0x2007E2);
    bytes32 constant VK_T = keccak256("transfer");
    bytes32 constant VK_S = keccak256("split");
    bytes32 constant VK_W = keccak256("withdraw");

    ShieldedPool pool;
    VerifierRegistry registry;
    MockTokenRemote remote;
    AcceptAllVerifier verifier;
    address relayer = address(0xBEEF);

    function _deployPool() internal {
        remote = new MockTokenRemote();
        verifier = new AcceptAllVerifier();
        registry = new VerifierRegistry(address(this));
        registry.register(VK_T, IHonkVerifier(address(verifier)), "transfer");
        registry.register(VK_S, IHonkVerifier(address(verifier)), "split");
        registry.register(VK_W, IHonkVerifier(address(verifier)), "withdraw");
        pool = new ShieldedPool(IERC20Like(address(remote)), HOME_ID, TOKEN_HOME, ROUTER, registry, VK_T, VK_S, VK_W);
    }

    function _deposit(uint256 denomination, uint256 precommit) internal returns (bool) {
        return remote.deliver(
            HOME_ID, TOKEN_HOME, ROUTER, address(pool), pool.netOf(denomination), abi.encode(precommit), address(0xFA11)
        );
    }

    function _notes2() internal pure returns (ShieldedPool.NoteData[2] memory n) {
        n[0] = ShieldedPool.NoteData(hex"01", 1);
        n[1] = ShieldedPool.NoteData(hex"02", 2);
    }

    function _transferArgs(uint256 n0, uint256 n1, uint256 c0, uint256 c1)
        internal
        view
        returns (ShieldedPool.TransferArgs memory a)
    {
        a.root = pool.currentRoot();
        a.nullifiers = [n0, n1];
        a.commitments = [c0, c1];
        a.fee = pool.SEND_FEE();
        a.relayer = relayer;
        a.notes = _notes2();
    }
}
