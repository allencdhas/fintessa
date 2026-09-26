// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";

import {MockMintableERC20} from "../src/mocks/MockMintableERC20.sol";
import {BentoBoxRouter} from "../src/BentoBoxRouter.sol";
import {BasketLeg} from "../src/interfaces/IBentoBoxRouter.sol";

/// @notice Go/No-Go #1 smoke test: mint bWETH to a fresh "user" key, split it 33/33/34
/// across bUSDC/bDAI/bLINK against the pools seeded by `DeployBentoBox.s.sol`, and print
/// the resulting balances. Run this after DeployBentoBox to prove the whole loop works
/// end-to-end on a live RPC before the frontend depends on it.
contract SmokeTestSplitSwap is Script {
    using stdJson for string;

    function run() external {
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);

        address bWETH = json.readAddress(".bWETH");
        address bUSDC = json.readAddress(".bUSDC");
        address bDAI = json.readAddress(".bDAI");
        address bLINK = json.readAddress(".bLINK");
        address router = json.readAddress(".router");

        PoolKey memory keyUsdc = _readPoolKey(json, ".poolUsdc");
        PoolKey memory keyDai = _readPoolKey(json, ".poolDai");
        PoolKey memory keyLink = _readPoolKey(json, ".poolLink");

        uint256 userKey = vm.envOr("SMOKE_USER_PRIVATE_KEY", uint256(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d));
        address user = vm.addr(userKey);

        uint256 amountIn = 1 ether;

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        MockMintableERC20(bWETH).mint(user, amountIn);
        vm.stopBroadcast();

        BasketLeg[] memory legs = new BasketLeg[](3);
        legs[0] = BasketLeg({
            poolKey: keyUsdc,
            zeroForOne: Currency.unwrap(keyUsdc.currency0) == bWETH,
            weightBps: 3300,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });
        legs[1] = BasketLeg({
            poolKey: keyDai,
            zeroForOne: Currency.unwrap(keyDai.currency0) == bWETH,
            weightBps: 3300,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });
        legs[2] = BasketLeg({
            poolKey: keyLink,
            zeroForOne: Currency.unwrap(keyLink.currency0) == bWETH,
            weightBps: 3400,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });

        vm.startBroadcast(userKey);
        IERC20(bWETH).approve(router, amountIn);
        uint256[] memory amountsOut = BentoBoxRouter(router).splitSwap(bWETH, amountIn, legs, block.timestamp + 1 hours);
        vm.stopBroadcast();

        console2.log("=== Go/No-Go #1 smoke test result ===");
        console2.log("user:", user);
        console2.log("bWETH in :", amountIn);
        console2.log("bUSDC out:", amountsOut[0]);
        console2.log("bDAI  out:", amountsOut[1]);
        console2.log("bLINK out:", amountsOut[2]);
        console2.log("bWETH balance after:", IERC20(bWETH).balanceOf(user));
        console2.log("bUSDC balance after:", IERC20(bUSDC).balanceOf(user));
        console2.log("bDAI  balance after:", IERC20(bDAI).balanceOf(user));
        console2.log("bLINK balance after:", IERC20(bLINK).balanceOf(user));
    }

    function _readPoolKey(string memory json, string memory prefix) internal pure returns (PoolKey memory) {
        address currency0 = json.readAddress(string.concat(prefix, ".currency0"));
        address currency1 = json.readAddress(string.concat(prefix, ".currency1"));
        uint24 fee = uint24(json.readUint(string.concat(prefix, ".fee")));
        int24 tickSpacing = int24(json.readInt(string.concat(prefix, ".tickSpacing")));
        address hooks = json.readAddress(string.concat(prefix, ".hooks"));
        return PoolKey({
            currency0: Currency.wrap(currency0),
            currency1: Currency.wrap(currency1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hooks)
        });
    }
}
