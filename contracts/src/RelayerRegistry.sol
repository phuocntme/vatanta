// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// Open relayer registration: anyone can list an endpoint. Clients pick one (or self-submit).
contract RelayerRegistry {
    struct Relayer {
        string url;
        uint256 sendFee; // micro-USDC, informational; the proof binds the real fee
        uint16 feeBps; // deposit/withdraw fee in basis points, informational
        uint64 registeredAt;
        bool active;
    }

    mapping(address => Relayer) public relayers;
    address[] public relayerList;

    event RelayerRegistered(address indexed relayer, string url, uint256 sendFee, uint16 feeBps);
    event RelayerUnregistered(address indexed relayer);

    error EmptyUrl();
    error NotRegistered();

    function register(string calldata url, uint256 sendFee, uint16 feeBps) external {
        if (bytes(url).length == 0) revert EmptyUrl();
        Relayer storage r = relayers[msg.sender];
        if (r.registeredAt == 0) relayerList.push(msg.sender);
        r.url = url;
        r.sendFee = sendFee;
        r.feeBps = feeBps;
        r.registeredAt = uint64(block.timestamp);
        r.active = true;
        emit RelayerRegistered(msg.sender, url, sendFee, feeBps);
    }

    function unregister() external {
        Relayer storage r = relayers[msg.sender];
        if (!r.active) revert NotRegistered();
        r.active = false;
        emit RelayerUnregistered(msg.sender);
    }

    function count() external view returns (uint256) {
        return relayerList.length;
    }

    /// Active relayers (small list; fine for a view call).
    function active() external view returns (address[] memory addrs, string[] memory urls) {
        uint256 n;
        for (uint256 i = 0; i < relayerList.length; i++) {
            if (relayers[relayerList[i]].active) n++;
        }
        addrs = new address[](n);
        urls = new string[](n);
        uint256 j;
        for (uint256 i = 0; i < relayerList.length; i++) {
            Relayer storage r = relayers[relayerList[i]];
            if (r.active) {
                addrs[j] = relayerList[i];
                urls[j] = r.url;
                j++;
            }
        }
    }
}
