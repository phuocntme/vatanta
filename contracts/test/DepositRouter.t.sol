// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {DepositRouter} from "../src/DepositRouter.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {IERC20PermitLike} from "../src/interfaces/IERC20Like.sol";
import {IERC20TokenTransferrer} from "../src/interfaces/IICTT.sol";
import {MockTokenHome} from "./utils/Mocks.sol";
import {ERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/ERC20.sol";

contract DepositRouterTest is Test {
    MockUSDC usdc;
    MockTokenHome home;
    DepositRouter router;
    bytes32 constant L1 = bytes32(uint256(0x11));
    address constant REMOTE = address(0x2E);
    address constant POOL = address(0x9001);
    address relayer = address(0xBEEF);
    uint256 ownerPk = 0xA11CE;
    address owner;

    function setUp() public {
        usdc = new MockUSDC();
        home = new MockTokenHome(ERC20(address(usdc)));
        router = new DepositRouter(IERC20PermitLike(address(usdc)), IERC20TokenTransferrer(address(home)), L1, REMOTE);
        router.setPool(POOL);
        owner = vm.addr(ownerPk);
        usdc.mint(owner, 2_350e6);
    }

    function _pieces() internal pure returns (DepositRouter.Piece[] memory p) {
        // 2,350 = 2×1,000 + 3×100 + 5×10
        p = new DepositRouter.Piece[](10);
        uint256[10] memory d = [uint256(1_000e6), 1_000e6, 100e6, 100e6, 100e6, 10e6, 10e6, 10e6, 10e6, 10e6];
        for (uint256 i = 0; i < 10; i++) p[i] = DepositRouter.Piece(d[i], bytes32(i + 1));
    }

    function _intent() internal view returns (DepositRouter.DepositIntent memory it) {
        it.owner = owner;
        it.gross = 2_350e6;
        it.pieces = _pieces();
        it.feeRecipient = relayer;
        it.nonce = 0;
        it.deadline = block.timestamp + 1 days;
    }

    function _sign(bytes32 digest, uint256 pk) internal pure returns (DepositRouter.Sig memory s) {
        (s.v, s.r, s.s) = vm.sign(pk, digest);
    }

    function _permit(uint256 value, uint256 deadline) internal view returns (DepositRouter.Sig memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                address(router),
                value,
                usdc.nonces(owner),
                deadline
            )
        );
        return _sign(keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash)), ownerPk);
    }

    function test_deposit_full_flow() public {
        DepositRouter.DepositIntent memory it = _intent();
        DepositRouter.Sig memory ps = _permit(it.gross, it.deadline);
        DepositRouter.Sig memory is_ = _sign(router.intentDigest(it), ownerPk);
        vm.prank(relayer);
        router.deposit(it, ps, is_);
        assertEq(home.callCount(), 10);
        assertEq(usdc.balanceOf(owner), 0);
        // fee = 0.25% of 2,350 = 5.875
        assertEq(usdc.balanceOf(relayer), 5.875e6);
        assertEq(usdc.balanceOf(address(home)), 2_344.125e6);
        (bytes32 dest, address destT, address rc, bytes memory payload, uint256 amt, address fb) = home.calls(0);
        assertEq(dest, L1);
        assertEq(destT, REMOTE);
        assertEq(rc, POOL);
        assertEq(abi.decode(payload, (bytes32)), bytes32(uint256(1)));
        assertEq(amt, 997.5e6);
        assertEq(fb, owner);
        assertEq(router.piecesByDenomination(10e6), 5);
    }

    function test_relayer_cannot_swap_precommits() public {
        DepositRouter.DepositIntent memory it = _intent();
        DepositRouter.Sig memory ps = _permit(it.gross, it.deadline);
        DepositRouter.Sig memory is_ = _sign(router.intentDigest(it), ownerPk);
        it.pieces[0].precommit = bytes32(uint256(0xEE));
        vm.expectRevert(DepositRouter.BadIntentSignature.selector);
        router.deposit(it, ps, is_);
    }

    function test_relayer_cannot_change_fee_recipient() public {
        DepositRouter.DepositIntent memory it = _intent();
        DepositRouter.Sig memory ps = _permit(it.gross, it.deadline);
        DepositRouter.Sig memory is_ = _sign(router.intentDigest(it), ownerPk);
        it.feeRecipient = address(0xE11E);
        vm.expectRevert(DepositRouter.BadIntentSignature.selector);
        router.deposit(it, ps, is_);
    }

    function test_replay_rejected() public {
        usdc.mint(owner, 2_350e6);
        DepositRouter.DepositIntent memory it = _intent();
        DepositRouter.Sig memory ps = _permit(it.gross, it.deadline);
        DepositRouter.Sig memory is_ = _sign(router.intentDigest(it), ownerPk);
        router.deposit(it, ps, is_);
        vm.expectRevert(DepositRouter.NonceUsed.selector);
        router.deposit(it, ps, is_);
    }

    function test_minimum_and_rounding() public {
        DepositRouter.DepositIntent memory it = _intent();
        it.gross = 10e6;
        it.pieces = new DepositRouter.Piece[](1);
        it.pieces[0] = DepositRouter.Piece(10e6, bytes32(uint256(1)));
        DepositRouter.Sig memory ps = _permit(it.gross, it.deadline);
        DepositRouter.Sig memory is_ = _sign(router.intentDigest(it), ownerPk);
        vm.expectRevert(DepositRouter.BadAmount.selector);
        router.deposit(it, ps, is_);
    }

    function test_rejects_non_denomination_piece() public {
        DepositRouter.DepositIntent memory it = _intent();
        it.gross = 50e6;
        it.pieces = new DepositRouter.Piece[](1);
        it.pieces[0] = DepositRouter.Piece(50e6, bytes32(uint256(1)));
        DepositRouter.Sig memory ps = _permit(it.gross, it.deadline);
        DepositRouter.Sig memory is_ = _sign(router.intentDigest(it), ownerPk);
        vm.expectRevert(abi.encodeWithSelector(DepositRouter.NotADenomination.selector, 50e6));
        router.deposit(it, ps, is_);
    }

    function test_pieces_must_sum_to_gross() public {
        DepositRouter.DepositIntent memory it = _intent();
        it.gross = 2_360e6;
        DepositRouter.Sig memory ps = _permit(it.gross, it.deadline);
        DepositRouter.Sig memory is_ = _sign(router.intentDigest(it), ownerPk);
        vm.expectRevert(DepositRouter.BadAmount.selector);
        router.deposit(it, ps, is_);
    }

    function test_expired() public {
        DepositRouter.DepositIntent memory it = _intent();
        DepositRouter.Sig memory ps = _permit(it.gross, it.deadline);
        DepositRouter.Sig memory is_ = _sign(router.intentDigest(it), ownerPk);
        vm.warp(it.deadline + 1);
        vm.expectRevert(DepositRouter.Expired.selector);
        router.deposit(it, ps, is_);
    }

    function test_frontrun_permit_still_works() public {
        DepositRouter.DepositIntent memory it = _intent();
        DepositRouter.Sig memory ps = _permit(it.gross, it.deadline);
        DepositRouter.Sig memory is_ = _sign(router.intentDigest(it), ownerPk);
        usdc.permit(owner, address(router), it.gross, it.deadline, ps.v, ps.r, ps.s); // griefer
        router.deposit(it, ps, is_);
        assertEq(home.callCount(), 10);
    }

    function test_set_pool_once() public {
        vm.expectRevert(DepositRouter.PoolAlreadySet.selector);
        router.setPool(address(1));
    }
}
