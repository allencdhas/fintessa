// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
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
import {SwapLeg, IBentoBoxRouter} from "../src/interfaces/IBentoBoxRouter.sol";

/// @notice Unit tests for `BentoBoxRouter.rebalance`: selling over-weight holdings and buying
/// under-weight ones atomically through the hub (bWETH) currency, and the same all-or-nothing
/// fail-safe `splitSwap` has — including against a hook that cranks its dynamic LP fee to 100%.
contract RebalanceTest is PoolSetup {
    function setUp() public {
        _setUpBentoBox();
        // These tests rebalance an EXISTING bUSDC holding, not the bWETH `splitSwap` already
        // funds `user` with — mint it and approve the router the same way the deploy script
        // approves every basket token.
        bUSDC.mint(user, 10_000 ether);
        vm.prank(user);
        IERC20(address(bUSDC)).approve(address(router), type(uint256).max);
    }

    function _sellLeg(address soldToken, PoolKey memory key, uint256 amountIn, uint256 pricePerWeth)
        internal
        pure
        returns (SwapLeg memory)
    {
        bool zeroForOne = Currency.unwrap(key.currency0) == soldToken;
        uint256 expectedOut = amountIn / pricePerWeth; // soldToken -> weth
        uint256 minOut = (expectedOut * 98) / 100;
        return SwapLeg({poolKey: key, zeroForOne: zeroForOne, amountIn: amountIn, amountOutMinimum: uint128(minOut), sqrtPriceLimitX96: 0});
    }

    function _buyLeg(PoolKey memory key, uint256 hubAmountIn, uint256 pricePerWeth) internal view returns (SwapLeg memory) {
        bool zeroForOne = Currency.unwrap(key.currency0) == address(bWETH);
        uint256 expectedOut = hubAmountIn * pricePerWeth; // weth -> boughtToken
        uint256 minOut = (expectedOut * 98) / 100;
        return SwapLeg({poolKey: key, zeroForOne: zeroForOne, amountIn: hubAmountIn, amountOutMinimum: uint128(minOut), sqrtPriceLimitX96: 0});
    }

    function test_rebalance_surplusHub_refundedToUser() public {
        SwapLeg[] memory sellLegs = new SwapLeg[](1);
        sellLegs[0] = _sellLeg(address(bUSDC), keyUsdc, 200 ether, 2000); // ~0.1 weth expected

        SwapLeg[] memory buyLegs = new SwapLeg[](1);
        buyLegs[0] = _buyLeg(keyLink, 0.05 ether, 15); // spends less hub than the sell raises

        uint256 usdcBefore = bUSDC.balanceOf(user);
        uint256 wethBefore = bWETH.balanceOf(user);
        uint256 linkBefore = bLINK.balanceOf(user);

        vm.prank(user);
        (uint256[] memory soldOut, uint256[] memory boughtOut) =
            router.rebalance(address(bWETH), sellLegs, buyLegs, block.timestamp + 1 hours);

        assertEq(bUSDC.balanceOf(user), usdcBefore - 200 ether, "sold bUSDC deducted exactly");
        assertEq(bLINK.balanceOf(user), linkBefore + boughtOut[0], "bought bLINK credited exactly");
        assertGt(soldOut[0], 0.05 ether, "sold more hub currency than was spent buying");
        assertEq(bWETH.balanceOf(user), wethBefore + (soldOut[0] - 0.05 ether), "surplus hub currency refunded");

        assertEq(bUSDC.balanceOf(address(router)), 0, "no bUSDC dust");
        assertEq(bWETH.balanceOf(address(router)), 0, "no bWETH dust");
        assertEq(bLINK.balanceOf(address(router)), 0, "no bLINK dust");
    }

    function test_rebalance_shortfallHub_pulledFromUser() public {
        SwapLeg[] memory sellLegs = new SwapLeg[](1);
        sellLegs[0] = _sellLeg(address(bUSDC), keyUsdc, 50 ether, 2000); // ~0.025 weth expected

        SwapLeg[] memory buyLegs = new SwapLeg[](1);
        buyLegs[0] = _buyLeg(keyLink, 0.1 ether, 15); // needs more hub than the sell raises

        uint256 wethBefore = bWETH.balanceOf(user);
        uint256 linkBefore = bLINK.balanceOf(user);

        vm.prank(user);
        (uint256[] memory soldOut, uint256[] memory boughtOut) =
            router.rebalance(address(bWETH), sellLegs, buyLegs, block.timestamp + 1 hours);

        assertLt(soldOut[0], 0.1 ether, "sold less hub currency than was spent buying");
        assertEq(bWETH.balanceOf(user), wethBefore - (0.1 ether - soldOut[0]), "shortfall pulled from user's bWETH");
        assertEq(bLINK.balanceOf(user), linkBefore + boughtOut[0], "bought bLINK credited exactly");
        assertEq(bWETH.balanceOf(address(router)), 0, "no bWETH dust");
    }

    function test_rebalance_revertsOnSlippage_wholeTransactionAborts() public {
        SwapLeg[] memory sellLegs = new SwapLeg[](1);
        sellLegs[0] = _sellLeg(address(bUSDC), keyUsdc, 200 ether, 2000);
        sellLegs[0].amountOutMinimum = type(uint128).max; // impossible to satisfy

        SwapLeg[] memory buyLegs = new SwapLeg[](1);
        buyLegs[0] = _buyLeg(keyLink, 0.05 ether, 15);

        uint256 usdcBefore = bUSDC.balanceOf(user);
        uint256 wethBefore = bWETH.balanceOf(user);
        uint256 linkBefore = bLINK.balanceOf(user);

        vm.prank(user);
        vm.expectPartialRevert(IBentoBoxRouter.SlippageExceeded.selector);
        router.rebalance(address(bWETH), sellLegs, buyLegs, block.timestamp + 1 hours);

        assertEq(bUSDC.balanceOf(user), usdcBefore, "bUSDC untouched");
        assertEq(bWETH.balanceOf(user), wethBefore, "bWETH untouched");
        assertEq(bLINK.balanceOf(user), linkBefore, "bLINK untouched (the healthy buy leg never ran either)");
    }

    function test_rebalance_revertsOnDeadlineExpired() public {
        SwapLeg[] memory sellLegs = new SwapLeg[](1);
        sellLegs[0] = _sellLeg(address(bUSDC), keyUsdc, 200 ether, 2000);
        SwapLeg[] memory buyLegs = new SwapLeg[](0);

        vm.prank(user);
        vm.expectRevert(IBentoBoxRouter.DeadlineExpired.selector);
        router.rebalance(address(bWETH), sellLegs, buyLegs, block.timestamp - 1);
    }

    function test_rebalance_revertsOnNoLegs() public {
        SwapLeg[] memory sellLegs = new SwapLeg[](0);
        SwapLeg[] memory buyLegs = new SwapLeg[](0);

        vm.prank(user);
        vm.expectRevert(IBentoBoxRouter.NoLegsProvided.selector);
        router.rebalance(address(bWETH), sellLegs, buyLegs, block.timestamp + 1 hours);
    }

    // --- The ask: prove `rebalance` aborts the ENTIRE transaction if a pool's hook cranks its
    // dynamic LP fee to 100% mid-flight, exactly like `splitSwap` already does. ---

    function test_rebalance_maliciousHook_100PercentFee_abortsEntireRebalance_userFundsSafe() public {
        (DynamicFeesTestHook hook, PoolKey memory maliciousKeyUsdc) = _deployMaliciousDynamicFeeUsdcPool();

        SwapLeg[] memory sellLegs = new SwapLeg[](1);
        sellLegs[0] = _sellLeg(address(bUSDC), maliciousKeyUsdc, 200 ether, 2000);

        SwapLeg[] memory buyLegs = new SwapLeg[](1);
        buyLegs[0] = _buyLeg(keyLink, 0.05 ether, 15); // a perfectly healthy leg, on an unrelated pool

        uint256 usdcBefore = bUSDC.balanceOf(user);
        uint256 wethBefore = bWETH.balanceOf(user);
        uint256 linkBefore = bLINK.balanceOf(user);

        hook.setFee(uint24(LPFeeLibrary.MAX_LP_FEE)); // 100% fee, cranked mid-flight

        vm.prank(user);
        vm.expectPartialRevert(IBentoBoxRouter.SlippageExceeded.selector);
        router.rebalance(address(bWETH), sellLegs, buyLegs, block.timestamp + 1 hours);

        // Capital protection: NOTHING moved, not even the untouched, perfectly healthy buy leg.
        assertEq(bUSDC.balanceOf(user), usdcBefore, "bUSDC unchanged (the attacked leg)");
        assertEq(bWETH.balanceOf(user), wethBefore, "bWETH unchanged");
        assertEq(bLINK.balanceOf(user), linkBefore, "bLINK unchanged (a healthy leg, rolled back too)");
        assertEq(bWETH.balanceOf(address(router)), 0, "router holds no stranded funds");
    }

    function _deployMaliciousDynamicFeeUsdcPool() internal returns (DynamicFeesTestHook hook, PoolKey memory key) {
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(address(this), flags, type(DynamicFeesTestHook).creationCode, "");
        hook = new DynamicFeesTestHook{salt: salt}();
        require(address(hook) == hookAddress, "hook address mismatch");

        hook.setManager(poolManager);
        hook.setFee(FEE); // starts indistinguishable from an ordinary 0.3% pool

        bool wethIsToken0 = address(bWETH) < address(bUSDC);
        key = PoolKey({
            currency0: Currency.wrap(wethIsToken0 ? address(bWETH) : address(bUSDC)),
            currency1: Currency.wrap(wethIsToken0 ? address(bUSDC) : address(bWETH)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });

        (uint256 num, uint256 den) = wethIsToken0 ? (uint256(2000), uint256(1)) : (uint256(1), uint256(2000));
        uint160 sqrtPriceX96 = _sqrtPriceX96(num, den);
        poolManager.initialize(key, sqrtPriceX96);

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
            key,
            ModifyLiquidityParams({tickLower: tickLower, tickUpper: tickUpper, liquidityDelta: int256(uint256(liquidity)), salt: 0}),
            bytes("")
        );
    }
}
