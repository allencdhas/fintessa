// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {MockMintableERC20} from "../../src/mocks/MockMintableERC20.sol";
import {BentoBoxRouter} from "../../src/BentoBoxRouter.sol";
import {BasketLeg} from "../../src/interfaces/IBentoBoxRouter.sol";

/// @notice Shared local-`PoolManager` + seeded-pools fixture reused across the router's
/// unit tests, mirroring `script/DeployBentoBox.s.sol`'s seeding logic at test scale.
abstract contract PoolSetup is Test {
    uint24 internal constant FEE = 3000;
    int24 internal constant TICK_SPACING = 60;
    int24 internal constant HALF_RANGE_TICKS = 2500;

    IPoolManager internal poolManager;
    BentoBoxRouter internal router;
    PoolModifyLiquidityTest internal lpRouter;

    MockMintableERC20 internal bWETH;
    MockMintableERC20 internal bUSDC;
    MockMintableERC20 internal bDAI;
    MockMintableERC20 internal bLINK;

    PoolKey internal keyUsdc;
    PoolKey internal keyDai;
    PoolKey internal keyLink;

    address internal user = makeAddr("user");

    function _setUpBentoBox() internal {
        poolManager = IPoolManager(address(new PoolManager(address(this))));
        router = new BentoBoxRouter(poolManager);
        lpRouter = new PoolModifyLiquidityTest(poolManager);

        bWETH = new MockMintableERC20("Bento Wrapped Ether", "bWETH", 18);
        bUSDC = new MockMintableERC20("Bento USD", "bUSDC", 18);
        bDAI = new MockMintableERC20("Bento DAI", "bDAI", 18);
        bLINK = new MockMintableERC20("Bento LINK", "bLINK", 18);

        bWETH.mint(address(this), 10_000 ether);
        bUSDC.mint(address(this), 20_000_000 ether);
        bDAI.mint(address(this), 20_000_000 ether);
        bLINK.mint(address(this), 1_333_000 ether);

        IERC20(address(bWETH)).approve(address(lpRouter), type(uint256).max);
        IERC20(address(bUSDC)).approve(address(lpRouter), type(uint256).max);
        IERC20(address(bDAI)).approve(address(lpRouter), type(uint256).max);
        IERC20(address(bLINK)).approve(address(lpRouter), type(uint256).max);

        keyUsdc = _initAndSeedPool(address(bWETH), address(bUSDC), 2000, 1, 50);
        keyDai = _initAndSeedPool(address(bWETH), address(bDAI), 2000, 1, 50);
        keyLink = _initAndSeedPool(address(bWETH), address(bLINK), 2000, 15, 50);

        // Fund the test user with input token + an approval to the router.
        bWETH.mint(user, 100 ether);
        vm.prank(user);
        IERC20(address(bWETH)).approve(address(router), type(uint256).max);
    }

    /// @dev Builds a leg for `outToken`'s pool with a generous default 2% slippage bound
    /// computed off of the (fixed, known-at-test-time) seed price ratio.
    function _leg(address outToken, PoolKey memory key, uint16 weightBps, uint256 legAmountInWei, uint256 pricePerWeth)
        internal
        view
        returns (BasketLeg memory)
    {
        bool zeroForOne = Currency.unwrap(key.currency0) == address(bWETH);
        uint256 expectedOut = (legAmountInWei * pricePerWeth);
        uint256 minOut = (expectedOut * 98) / 100; // 2% slippage tolerance
        outToken; // silence unused-param warning when called for clarity at call sites
        return BasketLeg({
            poolKey: key,
            zeroForOne: zeroForOne,
            weightBps: weightBps,
            amountOutMinimum: uint128(minOut),
            sqrtPriceLimitX96: 0
        });
    }

    /// @param wethPriceUsd Assumed USD price of bWETH (e.g. 2000).
    /// @param tokenPriceUsd Assumed USD price of the other basket token (e.g. 1 for
    /// stablecoins, 15 for bLINK). Both tokens are 18 decimals, so price ratio == raw
    /// token amount ratio.
    /// @param wethSeedAmount How many whole bWETH-equivalents of depth to seed on each
    /// side of the pool (e.g. 50 => roughly 50 bWETH + 50*price quote token).
    function _initAndSeedPool(address tokenA, address tokenB, uint256 wethPriceUsd, uint256 tokenPriceUsd, uint256 wethSeedAmount)
        internal
        returns (PoolKey memory key)
    {
        bool wethIsToken0 = tokenA < tokenB;
        Currency currency0 = Currency.wrap(wethIsToken0 ? tokenA : tokenB);
        Currency currency1 = Currency.wrap(wethIsToken0 ? tokenB : tokenA);

        key = PoolKey({currency0: currency0, currency1: currency1, fee: FEE, tickSpacing: TICK_SPACING, hooks: IHooks(address(0))});

        // price = currency1/currency0. If weth is currency0, price = quote-per-weth =
        // wethPriceUsd/tokenPriceUsd; if weth is currency1, price = weth-per-quote =
        // tokenPriceUsd/wethPriceUsd.
        (uint256 num, uint256 den) = wethIsToken0 ? (wethPriceUsd, tokenPriceUsd) : (tokenPriceUsd, wethPriceUsd);
        uint160 sqrtPriceX96 = _sqrtPriceX96(num, den);

        int24 currentTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        int24 tickLower = _alignTick(currentTick - HALF_RANGE_TICKS, TICK_SPACING, true);
        int24 tickUpper = _alignTick(currentTick + HALF_RANGE_TICKS, TICK_SPACING, false);

        poolManager.initialize(key, sqrtPriceX96);

        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        uint256 wethDesired = wethSeedAmount * 1 ether;
        uint256 quoteDesired = (wethSeedAmount * wethPriceUsd * 1 ether) / tokenPriceUsd;
        uint256 amount0Desired = wethIsToken0 ? wethDesired : quoteDesired;
        uint256 amount1Desired = wethIsToken0 ? quoteDesired : wethDesired;

        uint128 liquidity =
            LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, amount0Desired, amount1Desired);

        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            bytes("")
        );
    }

    function _alignTick(int24 tick, int24 spacing, bool roundDown) internal pure returns (int24) {
        int24 aligned = (tick / spacing) * spacing;
        if (roundDown && tick < 0 && tick % spacing != 0) aligned -= spacing;
        if (!roundDown && tick > 0 && tick % spacing != 0) aligned += spacing;
        int24 minTick = TickMath.minUsableTick(spacing);
        int24 maxTick = TickMath.maxUsableTick(spacing);
        if (aligned < minTick) aligned = minTick;
        if (aligned > maxTick) aligned = maxTick;
        return aligned;
    }

    function _sqrtPriceX96(uint256 num, uint256 den) internal pure returns (uint160) {
        uint256 x = (num * (1 << 192)) / den;
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return uint160(y);
    }
}
