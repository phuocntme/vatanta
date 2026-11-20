// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {PoolFixture} from "./utils/PoolFixture.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {Field} from "../src/lib/Field.sol";
import {MerkleTree} from "../src/lib/MerkleTree.sol";

contract ShieldedPoolTest is PoolFixture {
    function setUp() public {
        _deployPool();
    }

    // ---------------------------------------------------------------- deposit
    function test_deposit_inserts_commitment() public {
        uint256 pre = 777;
        assertTrue(_deposit(100e6, pre));
        assertEq(pool.nextIndex(), 1);
        assertEq(remote.balanceOf(address(pool)), 99.75e6);
        assertEq(pool.depositCount(100e6), 1);
        // root equals a tree with the expected commitment
        uint256 c = Field.noteCommitment(99.75e6, pre);
        uint256 node = c;
        for (uint256 d = 0; d < 32; d++) node = Field.hash2(node, pool.zeros(d));
        assertEq(pool.currentRoot(), node);
    }

    function test_deposit_net_amounts() public view {
        assertEq(pool.netOf(10e6), 9.975e6);
        assertEq(pool.netOf(100e6), 99.75e6);
        assertEq(pool.netOf(1_000e6), 997.5e6);
        assertEq(pool.netOf(10_000e6), 9_975e6);
        assertEq(pool.denominationOfNet(997.5e6), 1_000e6);
        assertEq(pool.denominationOfNet(1_000e6), 0);
    }

    function test_deposit_rejects_non_denomination_and_falls_back() public {
        bool ok = remote.deliver(HOME_ID, TOKEN_HOME, ROUTER, address(pool), 50e6, abi.encode(uint256(1)), address(0xFA11));
        assertFalse(ok);
        assertEq(remote.balanceOf(address(0xFA11)), 50e6, "fallback got the funds");
        assertEq(pool.nextIndex(), 0);
    }

    function test_deposit_rejects_wrong_origin() public {
        uint256 amt = pool.netOf(10e6);
        assertFalse(remote.deliver(HOME_ID, TOKEN_HOME, address(0xBAD), address(pool), amt, abi.encode(uint256(1)), address(1)));
        assertFalse(remote.deliver(bytes32(uint256(1)), TOKEN_HOME, ROUTER, address(pool), amt, abi.encode(uint256(1)), address(1)));
        assertFalse(remote.deliver(HOME_ID, address(0xBAD), ROUTER, address(pool), amt, abi.encode(uint256(1)), address(1)));
        assertEq(pool.nextIndex(), 0);
    }

    function test_deposit_rejects_direct_call() public {
        vm.expectRevert(ShieldedPool.OnlyTokenRemote.selector);
        pool.receiveTokens(HOME_ID, TOKEN_HOME, ROUTER, address(remote), 9.975e6, abi.encode(uint256(1)));
    }

    function test_deposit_rejects_bad_payload() public {
        uint256 amt = pool.netOf(10e6);
        assertFalse(remote.deliver(HOME_ID, TOKEN_HOME, ROUTER, address(pool), amt, abi.encode(uint256(0)), address(1)));
        assertFalse(remote.deliver(HOME_ID, TOKEN_HOME, ROUTER, address(pool), amt, abi.encode(Field.P), address(1)));
        assertFalse(remote.deliver(HOME_ID, TOKEN_HOME, ROUTER, address(pool), amt, hex"01", address(1)));
    }

    // ---------------------------------------------------------------- transfer
    function test_transfer_spends_and_pays_fee() public {
        _deposit(100e6, 1);
        ShieldedPool.TransferArgs memory a = _transferArgs(11, 12, 21, 22);
        pool.transfer(hex"", a);
        assertTrue(pool.nullifierSpent(11));
        assertTrue(pool.nullifierSpent(12));
        assertEq(pool.nextIndex(), 3);
        assertEq(remote.balanceOf(relayer), 0.1e6);
        assertEq(remote.balanceOf(address(pool)), 99.75e6 - 0.1e6);
    }

    function test_transfer_rejects_double_spend() public {
        _deposit(100e6, 1);
        pool.transfer(hex"", _transferArgs(11, 12, 21, 22));
        ShieldedPool.TransferArgs memory a = _transferArgs(11, 13, 23, 24);
        vm.expectRevert(abi.encodeWithSelector(ShieldedPool.NullifierAlreadySpent.selector, 11));
        pool.transfer(hex"", a);
    }

    function test_transfer_rejects_duplicate_nullifier() public {
        _deposit(100e6, 1);
        ShieldedPool.TransferArgs memory a = _transferArgs(11, 11, 21, 22);
        vm.expectRevert(ShieldedPool.DuplicateNullifier.selector);
        pool.transfer(hex"", a);
    }

    function test_transfer_rejects_wrong_fee() public {
        _deposit(100e6, 1);
        ShieldedPool.TransferArgs memory a = _transferArgs(11, 12, 21, 22);
        a.fee = 0.2e6;
        vm.expectRevert(ShieldedPool.WrongFee.selector);
        pool.transfer(hex"", a);
    }

    function test_transfer_rejects_unknown_root() public {
        _deposit(100e6, 1);
        ShieldedPool.TransferArgs memory a = _transferArgs(11, 12, 21, 22);
        a.root = 12345;
        vm.expectRevert(ShieldedPool.UnknownRoot.selector);
        pool.transfer(hex"", a);
    }

    function test_transfer_rejects_invalid_proof() public {
        _deposit(100e6, 1);
        verifier.set(false);
        ShieldedPool.TransferArgs memory a = _transferArgs(11, 12, 21, 22);
        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        pool.transfer(hex"", a);
    }

    function test_transfer_old_root_within_window() public {
        _deposit(100e6, 1);
        uint256 oldRoot = pool.currentRoot();
        _deposit(10e6, 2);
        vm.warp(block.timestamp + 47 hours);
        ShieldedPool.TransferArgs memory a = _transferArgs(11, 12, 21, 22);
        a.root = oldRoot;
        pool.transfer(hex"", a);
        vm.warp(block.timestamp + 2 hours);
        a = _transferArgs(13, 14, 23, 24);
        a.root = oldRoot;
        vm.expectRevert(ShieldedPool.UnknownRoot.selector);
        pool.transfer(hex"", a);
    }

    function test_transfer_rejects_huge_ciphertext() public {
        _deposit(100e6, 1);
        ShieldedPool.TransferArgs memory a = _transferArgs(11, 12, 21, 22);
        a.notes[0].ciphertext = new bytes(257);
        vm.expectRevert(ShieldedPool.CiphertextTooLong.selector);
        pool.transfer(hex"", a);
    }

    function test_transfer_emits_notes() public {
        _deposit(100e6, 1);
        vm.expectEmit(true, false, false, true, address(pool));
        emit ShieldedPool.NoteCommitted(1, 21, 1, hex"01");
        vm.expectEmit(true, false, false, true, address(pool));
        emit ShieldedPool.NoteCommitted(2, 22, 2, hex"02");
        pool.transfer(hex"", _transferArgs(11, 12, 21, 22));
    }

    // ---------------------------------------------------------------- split
    function _splitArgs(uint256 pieces) internal view returns (ShieldedPool.SplitArgs memory a) {
        a.root = pool.currentRoot();
        a.nullifiers = [uint256(31), uint256(32)];
        for (uint256 i = 0; i < pieces; i++) a.denomCommitments[i] = 100 + i;
        a.changeCommitment = 999;
        a.fee = pool.SEND_FEE();
        a.relayer = relayer;
    }

    function test_split_inserts_only_filled_slots() public {
        _deposit(1_000e6, 1);
        pool.split(hex"", _splitArgs(5));
        assertEq(pool.nextIndex(), 1 + 5 + 1);
        assertEq(remote.balanceOf(relayer), 0.1e6);
    }

    function test_split_max_pieces() public {
        _deposit(10_000e6, 1);
        pool.split(hex"", _splitArgs(12));
        assertEq(pool.nextIndex(), 1 + 12 + 1);
    }

    // ---------------------------------------------------------------- withdraw
    function _withdrawArgs(uint256 n, uint256 amount) internal view returns (ShieldedPool.WithdrawArgs memory a) {
        a.root = pool.currentRoot();
        a.nullifier = n;
        a.amount = amount;
        a.recipient = address(0xC0FFEE);
        a.relayer = relayer;
    }

    function test_withdraw_bridges_net_and_pays_fee() public {
        _deposit(1_000e6, 1);
        _deposit(100e6, 2);
        uint256 before = remote.balanceOf(address(pool));
        pool.withdraw(hex"", _withdrawArgs(41, 100e6));
        assertEq(remote.balanceOf(relayer), 0.25e6);
        assertEq(remote.balanceOf(address(pool)), before - 100e6);
        (bytes32 dest, address destT, address rcpt, uint256 amt,, address fb) = remote.sent(0);
        assertEq(dest, HOME_ID);
        assertEq(destT, TOKEN_HOME);
        assertEq(rcpt, address(0xC0FFEE));
        assertEq(amt, 99.75e6);
        assertEq(fb, address(0), "single hop has no multi-hop fallback");
        assertEq(pool.withdrawCount(100e6), 1);
    }

    // ---------------------------------------------------------------- withdraw to another L1 (§14)
    bytes32 constant ECHO_ID = bytes32(uint256(0xEC40));
    address constant ECHO_REMOTE = address(0xEC0);

    function test_withdraw_to_l1_goes_multi_hop_with_recipient_as_fallback() public {
        _deposit(1_000e6, 1);
        ShieldedPool.WithdrawArgs memory a = _withdrawArgs(41, 100e6);
        a.destBlockchainId = ECHO_ID;
        a.destTransferrer = ECHO_REMOTE;
        vm.expectEmit(true, true, false, true, address(pool));
        emit ShieldedPool.Withdrawal(41, 100e6, address(0xC0FFEE), relayer, 0.25e6, ECHO_ID, ECHO_REMOTE);
        pool.withdraw(hex"", a);
        (bytes32 dest, address destT, address rcpt, uint256 amt, uint256 gas, address fb) = remote.sent(0);
        assertEq(dest, ECHO_ID);
        assertEq(destT, ECHO_REMOTE);
        assertEq(rcpt, address(0xC0FFEE));
        assertEq(amt, 99.75e6);
        assertEq(gas, pool.WITHDRAW_REQUIRED_GAS());
        assertEq(fb, address(0xC0FFEE), "unknown remote => home pays the recipient on C-Chain");
        assertEq(remote.balanceOf(relayer), 0.25e6);
    }

    function test_withdraw_rejects_inconsistent_destination() public {
        _deposit(1_000e6, 1);
        ShieldedPool.WithdrawArgs memory a = _withdrawArgs(41, 100e6);
        a.destTransferrer = ECHO_REMOTE; // transferrer without a chain
        vm.expectRevert(ShieldedPool.BadDestination.selector);
        pool.withdraw(hex"", a);
        a.destTransferrer = address(0);
        a.destBlockchainId = ECHO_ID; // chain without a transferrer
        vm.expectRevert(ShieldedPool.BadDestination.selector);
        pool.withdraw(hex"", a);
        a.destBlockchainId = HOME_ID; // C-Chain must use the zero destination
        a.destTransferrer = TOKEN_HOME;
        vm.expectRevert(ShieldedPool.BadDestination.selector);
        pool.withdraw(hex"", a);
    }

    function test_withdraw_ext_data_hash_binds_destination() public view {
        assertEq(pool.withdrawExtDataHash(bytes32(0), address(0)), 0, "C-Chain keeps ext_data_hash = 0");
        uint256 h = pool.withdrawExtDataHash(ECHO_ID, ECHO_REMOTE);
        assertEq(h, uint256(keccak256(abi.encode(ECHO_ID, ECHO_REMOTE))) % Field.P);
        assertTrue(h != pool.withdrawExtDataHash(ECHO_ID, address(0xEC1)));
        assertTrue(h != pool.withdrawExtDataHash(bytes32(uint256(0xEC41)), ECHO_REMOTE));
    }

    function test_withdraw_rejects_non_denomination() public {
        _deposit(1_000e6, 1);
        ShieldedPool.WithdrawArgs memory a = _withdrawArgs(41, 50e6);
        vm.expectRevert(abi.encodeWithSelector(ShieldedPool.NotADenomination.selector, 50e6));
        pool.withdraw(hex"", a);
    }

    function test_withdraw_rejects_double_spend() public {
        _deposit(1_000e6, 1);
        _deposit(1_000e6, 2);
        pool.withdraw(hex"", _withdrawArgs(41, 100e6));
        ShieldedPool.WithdrawArgs memory a = _withdrawArgs(41, 100e6);
        vm.expectRevert(abi.encodeWithSelector(ShieldedPool.NullifierAlreadySpent.selector, 41));
        pool.withdraw(hex"", a);
    }

    function test_withdraw_rejects_zero_recipient() public {
        _deposit(1_000e6, 1);
        ShieldedPool.WithdrawArgs memory a = _withdrawArgs(41, 100e6);
        a.recipient = address(0);
        vm.expectRevert(ShieldedPool.ZeroRecipient.selector);
        pool.withdraw(hex"", a);
    }

    function test_ext_data_hash_view_matches() public view {
        ShieldedPool.NoteData[] memory n = new ShieldedPool.NoteData[](2);
        n[0] = ShieldedPool.NoteData(hex"01", 1);
        n[1] = ShieldedPool.NoteData(hex"02", 2);
        assertEq(pool.extDataHash(n), uint256(keccak256(abi.encode(n))) % Field.P);
    }
}
