// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {DepositRouter} from "../src/DepositRouter.sol";
import {ShieldedPool} from "../src/ShieldedPool.sol";
import {VerifierRegistry} from "../src/VerifierRegistry.sol";
import {RelayerRegistry} from "../src/RelayerRegistry.sol";
import {DestinationRegistry, ITokenHomeSettings} from "../src/DestinationRegistry.sol";
import {IHonkVerifier} from "../src/interfaces/IHonkVerifier.sol";
import {IERC20Like, IERC20PermitLike} from "../src/interfaces/IERC20Like.sol";
import {IERC20TokenTransferrer} from "../src/interfaces/IICTT.sol";
import {TransferVerifier} from "../src/verifiers/TransferVerifier.sol";
import {SplitVerifier} from "../src/verifiers/SplitVerifier.sol";
import {WithdrawVerifier} from "../src/verifiers/WithdrawVerifier.sol";

struct ProtocolRegistryEntry {
    uint256 version;
    address protocolAddress;
}

struct TokenRemoteSettings {
    address teleporterRegistryAddress;
    address teleporterManager;
    uint256 minTeleporterVersion;
    bytes32 tokenHomeBlockchainID;
    address tokenHomeAddress;
    uint8 tokenHomeDecimals;
}

interface ITokenRemoteRegister {
    struct TeleporterFeeInfo {
        address feeTokenAddress;
        uint256 amount;
    }

    function registerWithHome(TeleporterFeeInfo calldata feeInfo) external;
}

/// Stand-in for the Avalanche warp precompile during forge's local script execution only (the
/// broadcast transactions run against the real precompile on-chain).
contract MockWarp {
    bytes32 public blockchainId; // slot 0

    function getBlockchainID() external view returns (bytes32) {
        return blockchainId;
    }

    function sendWarpMessage(bytes calldata) external pure returns (bytes32) {
        return bytes32(0);
    }
}

/// Multi-phase deployment (chains alternate; see contracts/script/deploy.sh). Each phase prints
/// `DEPLOYED <key> <address>` lines that the shell script merges into deployments/<network>.json.
contract Deploy is Script {
    function _pk() internal view returns (uint256) {
        return vm.envUint("DEPLOYER_PK");
    }

    address constant WARP = 0x0200000000000000000000000000000000000005;

    function _mockWarp(bytes32 id) internal {
        // Avalanche reports a 1-byte placeholder code at precompile addresses; replace it locally.
        vm.etch(WARP, type(MockWarp).runtimeCode);
        vm.store(WARP, bytes32(0), id);
    }

    function _out(string memory key, address a) internal pure {
        console.log(string.concat("DEPLOYED ", key, " ", vm.toString(a)));
    }

    /// C-Chain: USDC (mock on local) + ICTT ERC20TokenHome.
    function phaseHome() external {
        _mockWarp(vm.envBytes32("C_BLOCKCHAIN_ID"));
        address usdc = vm.envOr("USDC", address(0));
        vm.startBroadcast(_pk());
        if (usdc == address(0)) {
            usdc = address(new MockUSDC());
            _out("usdcMock", usdc);
        }
        address home = deployCode(
            "ERC20TokenHome.sol:ERC20TokenHome",
            abi.encode(vm.envAddress("C_ICM_REGISTRY"), vm.addr(_pk()), uint256(1), usdc, uint8(6))
        );
        vm.stopBroadcast();
        _out("usdc", usdc);
        _out("tokenHome", home);
    }

    /// L1: ICTT ERC20TokenRemote (+ registerWithHome), verifiers, registries.
    function phaseRemote() external {
        _mockWarp(vm.envBytes32("L1_BLOCKCHAIN_ID"));
        vm.startBroadcast(_pk());
        address remote = deployCode(
            "ERC20TokenRemote.sol:ERC20TokenRemote",
            abi.encode(
                TokenRemoteSettings({
                    teleporterRegistryAddress: vm.envAddress("L1_ICM_REGISTRY"),
                    teleporterManager: vm.addr(_pk()),
                    minTeleporterVersion: 1,
                    tokenHomeBlockchainID: vm.envBytes32("C_BLOCKCHAIN_ID"),
                    tokenHomeAddress: vm.envAddress("TOKEN_HOME"),
                    tokenHomeDecimals: 6
                }),
                "USD Coin (bridged)",
                "USDC",
                uint8(6)
            )
        );
        ITokenRemoteRegister(remote).registerWithHome(ITokenRemoteRegister.TeleporterFeeInfo(address(0), 0));
        VerifierRegistry registry = new VerifierRegistry(vm.addr(_pk()));
        registry.register(vm.envBytes32("VK_TRANSFER"), IHonkVerifier(address(new TransferVerifier())), "transfer");
        registry.register(vm.envBytes32("VK_SPLIT"), IHonkVerifier(address(new SplitVerifier())), "split");
        registry.register(vm.envBytes32("VK_WITHDRAW"), IHonkVerifier(address(new WithdrawVerifier())), "withdraw");
        RelayerRegistry relayers = new RelayerRegistry();
        vm.stopBroadcast();
        _out("tokenRemote", remote);
        _out("verifierRegistry", address(registry));
        _out("relayerRegistry", address(relayers));
    }

    /// C-Chain: DepositRouter.
    function phaseRouter() external {
        vm.startBroadcast(_pk());
        DepositRouter r = new DepositRouter(
            IERC20PermitLike(vm.envAddress("USDC_ADDR")),
            IERC20TokenTransferrer(vm.envAddress("TOKEN_HOME")),
            vm.envBytes32("L1_BLOCKCHAIN_ID"),
            vm.envAddress("TOKEN_REMOTE")
        );
        vm.stopBroadcast();
        _out("depositRouter", address(r));
    }

    /// L1: ShieldedPool.
    function phasePool() external {
        vm.startBroadcast(_pk());
        ShieldedPool p = new ShieldedPool(
            IERC20Like(vm.envAddress("TOKEN_REMOTE")),
            vm.envBytes32("C_BLOCKCHAIN_ID"),
            vm.envAddress("TOKEN_HOME"),
            vm.envAddress("DEPOSIT_ROUTER"),
            VerifierRegistry(vm.envAddress("VERIFIER_REGISTRY")),
            vm.envBytes32("VK_TRANSFER"),
            vm.envBytes32("VK_SPLIT"),
            vm.envBytes32("VK_WITHDRAW")
        );
        vm.stopBroadcast();
        _out("shieldedPool", address(p));
    }

    /// C-Chain: DestinationRegistry (SPEC §14).
    function phaseDestinations() external {
        vm.startBroadcast(_pk());
        DestinationRegistry r = new DestinationRegistry(ITokenHomeSettings(vm.envAddress("TOKEN_HOME")));
        vm.stopBroadcast();
        _out("destinationRegistry", address(r));
    }

    /// Destination L1 (SPEC §14): ICTT ERC20TokenRemote for our home (+ registerWithHome). If the L1
    /// has Teleporter but DEST_ICM_REGISTRY is unset, a TeleporterRegistry listing the standard
    /// messenger is deployed first (ICTT only uses it to look up the messenger).
    function phaseDestRemote() external {
        _mockWarp(vm.envBytes32("DEST_BLOCKCHAIN_ID"));
        address reg = vm.envOr("DEST_ICM_REGISTRY", address(0));
        vm.startBroadcast(_pk());
        if (reg == address(0)) {
            ProtocolRegistryEntry[] memory e = new ProtocolRegistryEntry[](1);
            e[0] = ProtocolRegistryEntry(1, vm.envOr("DEST_MESSENGER", address(0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf)));
            reg = deployCode("TeleporterRegistry.sol:TeleporterRegistry", abi.encode(e));
            _out("destIcmRegistry", reg);
        }
        address remote = deployCode(
            "ERC20TokenRemote.sol:ERC20TokenRemote",
            abi.encode(
                TokenRemoteSettings({
                    teleporterRegistryAddress: reg,
                    teleporterManager: vm.addr(_pk()),
                    minTeleporterVersion: 1,
                    tokenHomeBlockchainID: vm.envBytes32("C_BLOCKCHAIN_ID"),
                    tokenHomeAddress: vm.envAddress("TOKEN_HOME"),
                    tokenHomeDecimals: 6
                }),
                "USD Coin (via Vatanta)",
                "USDC",
                uint8(6)
            )
        );
        ITokenRemoteRegister(remote).registerWithHome(ITokenRemoteRegister.TeleporterFeeInfo(address(0), 0));
        vm.stopBroadcast();
        _out("destTokenRemote", remote);
    }

    /// C-Chain: list a registered destination L1 in the DestinationRegistry.
    function phaseAddDestination() external {
        vm.startBroadcast(_pk());
        DestinationRegistry(vm.envAddress("DESTINATION_REGISTRY")).add(
            vm.envBytes32("DEST_BLOCKCHAIN_ID"), vm.envAddress("DEST_TOKEN_REMOTE"), vm.envUint("DEST_CHAIN_ID"), vm.envString("DEST_NAME")
        );
        vm.stopBroadcast();
    }

    /// C-Chain: wire the router to the pool.
    function phaseWire() external {
        vm.startBroadcast(_pk());
        DepositRouter(vm.envAddress("DEPOSIT_ROUTER")).setPool(vm.envAddress("SHIELDED_POOL"));
        vm.stopBroadcast();
    }
}
