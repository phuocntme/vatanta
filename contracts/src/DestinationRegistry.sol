// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// Read side of ICTT's TokenHome (v1.0.9) that the registry needs.
interface ITokenHomeSettings {
    struct RemoteTokenTransferrerSettings {
        bool registered;
        uint256 collateralNeeded;
        uint256 tokenMultiplier;
        bool multiplyOnRemote;
    }

    function getRemoteTokenTransferrerSettings(bytes32 remoteBlockchainID, address remoteTokenTransferrerAddress)
        external
        view
        returns (RemoteTokenTransferrerSettings memory);
}

/// C-Chain list of the L1s a withdrawal can go to besides C-Chain (SPEC §14). Open to every L1:
/// anyone can add one, but only if its ICTT TokenRemote is registered with Vatanta's TokenHome and
/// fully collateralized, i.e. the home will actually deliver to it. The pool does not read this list
/// (a withdraw proof names its destination itself, and the home falls back to the recipient on
/// C-Chain for an unknown remote); wallets and relayers use it to offer destinations.
contract DestinationRegistry {
    struct Destination {
        bytes32 blockchainId; // destination L1 (Avalanche blockchain id)
        address tokenRemote; // ICTT ERC20TokenRemote for our home on that L1
        uint256 evmChainId; // as claimed by the registrant; wallets check it against the L1's RPC
        string name;
        address registrant;
    }

    ITokenHomeSettings public immutable tokenHome;
    Destination[] internal _list;
    mapping(bytes32 => mapping(address => bool)) public listed;

    event DestinationAdded(uint256 indexed index, bytes32 indexed blockchainId, address tokenRemote, uint256 evmChainId, string name);

    error NotRegisteredWithHome();
    error NotCollateralized();
    error AlreadyListed();
    error BadName();

    constructor(ITokenHomeSettings tokenHome_) {
        tokenHome = tokenHome_;
    }

    function add(bytes32 blockchainId, address tokenRemote, uint256 evmChainId, string calldata name) external returns (uint256 index) {
        if (bytes(name).length == 0 || bytes(name).length > 64) revert BadName();
        if (listed[blockchainId][tokenRemote]) revert AlreadyListed();
        ITokenHomeSettings.RemoteTokenTransferrerSettings memory s =
            tokenHome.getRemoteTokenTransferrerSettings(blockchainId, tokenRemote);
        if (!s.registered) revert NotRegisteredWithHome();
        if (s.collateralNeeded != 0) revert NotCollateralized();
        listed[blockchainId][tokenRemote] = true;
        index = _list.length;
        _list.push(Destination(blockchainId, tokenRemote, evmChainId, name, msg.sender));
        emit DestinationAdded(index, blockchainId, tokenRemote, evmChainId, name);
    }

    function count() external view returns (uint256) {
        return _list.length;
    }

    function all() external view returns (Destination[] memory) {
        return _list;
    }
}
