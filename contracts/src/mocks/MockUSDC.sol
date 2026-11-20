// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts@5.0.2/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts@5.0.2/token/ERC20/extensions/ERC20Permit.sol";

/// 6-decimal USDC stand-in with EIP-2612 permit, for local networks only (Fuji uses Circle USDC).
contract MockUSDC is ERC20, ERC20Permit {
    address public immutable minter;

    constructor() ERC20("USD Coin (mock)", "USDC") ERC20Permit("USD Coin (mock)") {
        minter = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// Faucet: anyone may mint up to 100k per call on local/test networks.
    function mint(address to, uint256 amount) external {
        require(amount <= 100_000e6 || msg.sender == minter, "faucet cap");
        _mint(to, amount);
    }
}
