// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

// Pulls the unmodified ICTT v1.0.9 contracts into the build so scripts can deploy them.
import {ERC20TokenHome} from "@ictt/TokenHome/ERC20TokenHome.sol";
import {ERC20TokenRemote} from "@ictt/TokenRemote/ERC20TokenRemote.sol";
// For L1s that have Teleporter but no TeleporterRegistry we can name (SPEC §14, add-destination.sh).
import {TeleporterRegistry} from "@teleporter/registry/TeleporterRegistry.sol";
