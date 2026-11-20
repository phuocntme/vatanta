// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {DestinationRegistry, ITokenHomeSettings} from "../src/DestinationRegistry.sol";

/// Stands in for ICTT TokenHome.getRemoteTokenTransferrerSettings.
contract MockHomeSettings is ITokenHomeSettings {
    mapping(bytes32 => mapping(address => RemoteTokenTransferrerSettings)) internal s;

    function set(bytes32 id, address remote, bool registered, uint256 collateralNeeded) external {
        s[id][remote] = RemoteTokenTransferrerSettings(registered, collateralNeeded, 1, false);
    }

    function getRemoteTokenTransferrerSettings(bytes32 id, address remote)
        external
        view
        returns (RemoteTokenTransferrerSettings memory)
    {
        return s[id][remote];
    }
}

contract DestinationRegistryTest is Test {
    MockHomeSettings home;
    DestinationRegistry reg;
    bytes32 constant ECHO = bytes32(uint256(0xEC40));
    address constant REMOTE = address(0xEC0);

    function setUp() public {
        home = new MockHomeSettings();
        reg = new DestinationRegistry(home);
    }

    function test_anyone_adds_a_registered_collateralized_remote() public {
        home.set(ECHO, REMOTE, true, 0);
        vm.prank(address(0xA11CE));
        uint256 i = reg.add(ECHO, REMOTE, 173750, "Echo");
        assertEq(i, 0);
        assertEq(reg.count(), 1);
        DestinationRegistry.Destination[] memory all = reg.all();
        assertEq(all[0].blockchainId, ECHO);
        assertEq(all[0].tokenRemote, REMOTE);
        assertEq(all[0].evmChainId, 173750);
        assertEq(all[0].name, "Echo");
        assertEq(all[0].registrant, address(0xA11CE));
        assertTrue(reg.listed(ECHO, REMOTE));
    }

    function test_rejects_unregistered_remote() public {
        vm.expectRevert(DestinationRegistry.NotRegisteredWithHome.selector);
        reg.add(ECHO, REMOTE, 173750, "Echo");
    }

    function test_rejects_remote_that_still_needs_collateral() public {
        home.set(ECHO, REMOTE, true, 5);
        vm.expectRevert(DestinationRegistry.NotCollateralized.selector);
        reg.add(ECHO, REMOTE, 173750, "Echo");
    }

    function test_rejects_duplicates_and_bad_names() public {
        home.set(ECHO, REMOTE, true, 0);
        vm.expectRevert(DestinationRegistry.BadName.selector);
        reg.add(ECHO, REMOTE, 173750, "");
        vm.expectRevert(DestinationRegistry.BadName.selector);
        reg.add(ECHO, REMOTE, 173750, string(new bytes(65)));
        reg.add(ECHO, REMOTE, 173750, "Echo");
        vm.expectRevert(DestinationRegistry.AlreadyListed.selector);
        reg.add(ECHO, REMOTE, 173750, "Echo again");
    }
}
