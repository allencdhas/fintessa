// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @notice Open-mint testnet ERC-20 used for the Bento Box basket demo.
/// @dev Anyone can mint any amount to any address. This is a hackathon demo faucet
/// token, NOT a real asset — it exists purely so the demo never depends on
/// scarce/rate-limited third-party testnet faucets or v4 testnet liquidity.
contract MockMintableERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Open faucet mint — no access control, no rate limit, testnet only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
