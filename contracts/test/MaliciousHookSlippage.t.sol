// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {DynamicFeesTestHook} from "v4-core/src/test/DynamicFeesTestHook.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";

import {PoolSetup} from "./utils/PoolSetup.sol";
import {BasketLeg, IBentoBoxRouter} from "../src/interfaces/IBentoBoxRouter.sol";

/// @notice Proves the router's per-leg `amountOutMinimum` check is a real capital-protection
/// fail-safe against a pool whose *dynamic-fee hook* is cranked up after the fact — not just
/// against ordinary price slippage.
///
/// Why this matters: v4 lets a pool's owner attach a hook that can override its LP fee on
/// every swap, up to `LPFeeLibrary.MAX_LP_FEE` (100%). A router has no way to "trust" a pool
/// up front — it can only route through whatever `PoolKey` (and whatever hook) it's given.
/// That's exactly why the all-or-nothing revert exists: if a leg's hook charges 100% fee
/// right as the transaction lands, that leg's output collapses to ~0, breaches its
/// `amountOutMinimum`, and the ENTIRE `splitSwap` reverts — including the legs that were
/// perfectly healthy. The user gets their full original deposit back, or their exact basket
/// at a fair price. No partial, no stolen funds.
///
/// This is also why Bento Box is a plain router and not a hook itself: a hook only ever
/// protects the one pool it's deployed into (chosen at pool-creation time). A router isn't
/// bound to any pool — it can check and route through *any* pool it's handed, safe or
/// malicious, without needing to be integrated into each one ahead of time.
contract MaliciousHookSlippageTest is PoolSetup {
    DynamicFeesTestHook internal maliciousHook;
    PoolKey internal maliciousKeyUsdc;

    function setUp() public {
        _setUpBentoBox();
        _deployMaliciousDynamicFeePool();
    }

    function _deployMaliciousDynamicFeePool() internal {
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(address(this), flags, type(DynamicFeesTestHook).creationCode, "");
        maliciousHook = new DynamicFeesTestHook{salt: salt}();
        require(address(maliciousHook) == hookAddress, "hook address mismatch");

        maliciousHook.setManager(poolManager);
        maliciousHook.setFee(FEE); // starts indistinguishable from an ordinary 0.3% pool

        bool wethIsToken0 = address(bWETH) < address(bUSDC);
        maliciousKeyUsdc = PoolKey({
            currency0: Currency.wrap(wethIsToken0 ? address(bWETH) : address(bUSDC)),
            currency1: Currency.wrap(wethIsToken0 ? address(bUSDC) : address(bWETH)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(maliciousHook))
        });

        // Same seed price (2000 bUSDC per bWETH) and depth as the real bWETH/bUSDC pool, so
        // a healthy swap through this pool looks and behaves identically to a normal one.
        (uint256 num, uint256 den) = wethIsToken0 ? (uint256(2000), uint256(1)) : (uint256(1), uint256(2000));
        uint160 sqrtPriceX96 = _sqrtPriceX96(num, den);
        poolManager.initialize(maliciousKeyUsdc, sqrtPriceX96);

        int24 currentTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        int24 tickLower = _alignTick(currentTick - HALF_RANGE_TICKS, TICK_SPACING, true);
        int24 tickUpper = _alignTick(currentTick + HALF_RANGE_TICKS, TICK_SPACING, false);
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(tickUpper);

        uint256 wethDesired = 50 ether;
        uint256 usdcDesired = 50 * 2000 * 1 ether;
        uint256 amount0Desired = wethIsToken0 ? wethDesired : usdcDesired;
        uint256 amount1Desired = wethIsToken0 ? usdcDesired : wethDesired;
        uint128 liquidity =
            LiquidityAmounts.getLiquidityForAmounts(sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, amount0Desired, amount1Desired);

        lpRouter.modifyLiquidity(
            maliciousKeyUsdc,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: 0}),
            bytes("")
        );
    }

    function _threeWayLegsThroughMaliciousPool(uint256 amountIn) internal view returns (BasketLeg[] memory legs) {
        legs = new BasketLeg[](3);
        legs[0] = _leg(address(bUSDC), maliciousKeyUsdc, 3300, (amountIn * 3300) / 10_000, 2000);
        legs[1] = _leg(address(bDAI), keyDai, 3300, (amountIn * 3300) / 10_000, 2000);
        legs[2] = _leg(address(bLINK), keyLink, 3400, amountIn - (amountIn * 3300) / 10_000 * 2, 15);
    }

    /// The attack: a malicious (or compromised) pool owner cranks the hook's dynamic fee to
    /// 100% right as the user's transaction lands. The bUSDC leg's output collapses to ~0,
    /// which breaches its `amountOutMinimum` — the router reverts the WHOLE transaction, so
    /// the two perfectly healthy legs (bDAI, bLINK) never execute either.
    function test_maliciousHook_100PercentFee_revertsEntireBasket_userFundsFullySafe() public {
        uint256 amountIn = 1 ether;
        BasketLeg[] memory legs = _threeWayLegsThroughMaliciousPool(amountIn);

        uint256 wethBefore = bWETH.balanceOf(user);
        uint256 usdcBefore = bUSDC.balanceOf(user);
        uint256 daiBefore = bDAI.balanceOf(user);
        uint256 linkBefore = bLINK.balanceOf(user);

        maliciousHook.setFee(uint24(LPFeeLibrary.MAX_LP_FEE)); // 100% fee, cranked mid-flight

        vm.prank(user);
        vm.expectPartialRevert(IBentoBoxRouter.SlippageExceeded.selector);
        router.splitSwap(address(bWETH), amountIn, legs, block.timestamp + 1 hours);

        // Capital protection: NOTHING moved, not even the untouched legs.
        assertEq(bWETH.balanceOf(user), wethBefore, "bWETH fully refunded (never left the user)");
        assertEq(bUSDC.balanceOf(user), usdcBefore, "bUSDC unchanged (the attacked leg)");
        assertEq(bDAI.balanceOf(user), daiBefore, "bDAI unchanged (a healthy leg, rolled back too)");
        assertEq(bLINK.balanceOf(user), linkBefore, "bLINK unchanged (a healthy leg, rolled back too)");
        assertEq(bWETH.balanceOf(address(router)), 0, "router holds no stranded funds");
    }

    /// Control case: the same hooked, dynamic-fee pool behaving honestly (same fee as every
    /// other pool). The router needed zero special-case code to route through it — a hook
    /// is just another `PoolKey`, proving the router isn't limited to pools it was
    /// specifically integrated with ahead of time.
    function test_maliciousHook_benignFee_splitStillSucceedsThroughHookedPool() public {
        uint256 amountIn = 1 ether;
        BasketLeg[] memory legs = _threeWayLegsThroughMaliciousPool(amountIn);

        vm.prank(user);
        uint256[] memory amountsOut = router.splitSwap(address(bWETH), amountIn, legs, block.timestamp + 1 hours);

        assertEq(amountsOut.length, 3, "3 legs");
        assertGt(amountsOut[0], 0, "received bUSDC through the hooked pool");
        assertGt(amountsOut[1], 0, "received bDAI");
        assertGt(amountsOut[2], 0, "received bLINK");
    }
}
