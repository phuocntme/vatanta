// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {VerifierRegistry} from "../src/VerifierRegistry.sol";
import {RelayerRegistry} from "../src/RelayerRegistry.sol";
import {IHonkVerifier} from "../src/interfaces/IHonkVerifier.sol";
import {AcceptAllVerifier} from "./utils/Mocks.sol";

contract RegistriesTest is Test {
    VerifierRegistry vr;
    RelayerRegistry rr;
    AcceptAllVerifier v;

    function setUp() public {
        vr = new VerifierRegistry(address(this));
        rr = new RelayerRegistry();
        v = new AcceptAllVerifier();
    }

    function test_register_and_verify() public {
        vr.register(bytes32("k"), IHonkVerifier(address(v)), "x");
        assertTrue(vr.verify(bytes32("k"), "", new bytes32[](0)));
        assertEq(vr.nameOf(bytes32("k")), "x");
    }

    function test_write_once() public {
        vr.register(bytes32("k"), IHonkVerifier(address(v)), "x");
        vm.expectRevert(VerifierRegistry.AlreadyRegistered.selector);
        vr.register(bytes32("k"), IHonkVerifier(address(1)), "y");
    }

    function test_only_owner() public {
        vm.prank(address(2));
        vm.expectRevert(VerifierRegistry.NotOwner.selector);
        vr.register(bytes32("k"), IHonkVerifier(address(v)), "x");
    }

    function test_unknown_vk() public {
        vm.expectRevert(VerifierRegistry.UnknownVerifier.selector);
        vr.verify(bytes32("nope"), "", new bytes32[](0));
    }

    function test_transfer_ownership() public {
        vr.transferOwnership(address(2));
        vm.prank(address(2));
        vr.register(bytes32("k"), IHonkVerifier(address(v)), "x");
    }

    function test_relayer_open_registration() public {
        vm.prank(address(10));
        rr.register("https://r1.example", 100_000, 25);
        vm.prank(address(11));
        rr.register("https://r2.example", 100_000, 25);
        (address[] memory a, string[] memory u) = rr.active();
        assertEq(a.length, 2);
        assertEq(u[1], "https://r2.example");
        vm.prank(address(10));
        rr.unregister();
        (a,) = rr.active();
        assertEq(a.length, 1);
        assertEq(a[0], address(11));
        assertEq(rr.count(), 2);
    }

    function test_relayer_empty_url() public {
        vm.expectRevert(RelayerRegistry.EmptyUrl.selector);
        rr.register("", 0, 0);
    }
}
