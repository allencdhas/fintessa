// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

import {PoolSetup} from "./utils/PoolSetup.sol";
import {BasketLeg, IBentoBoxRouter} from "../src/interfaces/IBentoBoxRouter.sol";

contract BentoBoxRouterTest is PoolSetup {
    function setUp() public {
        _setUpBentoBox();
    }

    function _threeWayLegs(uint256 amountIn) internal view returns (BasketLeg[] memory legs) {
        legs = new BasketLeg[](3);
        // 33 / 33 / 34 bps split, matching the demo's "Equal split" preset.
        legs[0] = _leg(address(bUSDC), keyUsdc, 3300, (amountIn * 3300) / 10_000, 2000);
        legs[1] = _leg(address(bDAI), keyDai, 3300, (amountIn * 3300) / 10_000, 2000);
        legs[2] = _leg(address(bLINK), keyLink, 3400, amountIn - (amountIn * 3300) / 10_000 * 2, 15);
    }

    function test_splitSwap_happyPath_threeWay() public {
        uint256 amountIn = 1 ether;
        BasketLeg[] memory legs = _threeWayLegs(amountIn);

        uint256 wethBefore = bWETH.balanceOf(user);
        uint256 usdcBefore = bUSDC.balanceOf(user);
        uint256 daiBefore = bDAI.balanceOf(user);
        uint256 linkBefore = bLINK.balanceOf(user);

        vm.prank(user);
        uint256[] memory amountsOut = router.splitSwap(address(bWETH), amountIn, legs, block.timestamp + 1 hours);

        assertEq(amountsOut.length, 3, "3 legs");
        assertEq(bWETH.balanceOf(user), wethBefore - amountIn, "input pulled exactly once");
        assertGt(bUSDC.balanceOf(user), usdcBefore, "received bUSDC");
        assertGt(bDAI.balanceOf(user), daiBefore, "received bDAI");
        assertGt(bLINK.balanceOf(user), linkBefore, "received bLINK");

        assertEq(bUSDC.balanceOf(user) - usdcBefore, amountsOut[0], "reported amount matches balance delta (leg 0)");
        assertEq(bDAI.balanceOf(user) - daiBefore, amountsOut[1], "reported amount matches balance delta (leg 1)");
        assertEq(bLINK.balanceOf(user) - linkBefore, amountsOut[2], "reported amount matches balance delta (leg 2)");

        // No dust left behind in the router itself.
        assertEq(bWETH.balanceOf(address(router)), 0, "no bWETH dust");
        assertEq(bUSDC.balanceOf(address(router)), 0, "no bUSDC dust");
        assertEq(bDAI.balanceOf(address(router)), 0, "no bDAI dust");
        assertEq(bLINK.balanceOf(address(router)), 0, "no bLINK dust");
    }

    function test_splitSwap_revertsOnDeadlineExpired() public {
        uint256 amountIn = 1 ether;
        BasketLeg[] memory legs = _threeWayLegs(amountIn);

        vm.prank(user);
        vm.expectRevert(IBentoBoxRouter.DeadlineExpired.selector);
        router.splitSwap(address(bWETH), amountIn, legs, block.timestamp - 1);
    }

    function test_splitSwap_revertsOnSlippage_singleLegBreach() public {
        uint256 amountIn = 1 ether;
        BasketLeg[] memory legs = _threeWayLegs(amountIn);
        // Demand an absurdly high minimum out for leg 0 — the seeded pool cannot deliver it.
        legs[0].amountOutMinimum = type(uint128).max;

        uint256 wethBefore = bWETH.balanceOf(user);

        vm.prank(user);
        vm.expectRevert(); // SlippageExceeded(0, ..., ...)
        router.splitSwap(address(bWETH), amountIn, legs, block.timestamp + 1 hours);

        // Whole transaction reverted — atomicity holds, no funds moved.
        assertEq(bWETH.balanceOf(user), wethBefore, "balance unchanged after all-or-nothing revert");
    }

    function test_splitSwap_revertsOnWeightsNotSumming() public {
        uint256 amountIn = 1 ether;
        BasketLeg[] memory legs = _threeWayLegs(amountIn);
        legs[2].weightBps = 3300; // 3300 + 3300 + 3300 = 9900 != 10_000

        vm.prank(user);
        vm.expectRevert(IBentoBoxRouter.WeightsMustSumTo10000.selector);
        router.splitSwap(address(bWETH), amountIn, legs, block.timestamp + 1 hours);
    }

    function test_splitSwap_revertsOnEmptyLegs() public {
        BasketLeg[] memory legs = new BasketLeg[](0);

        vm.prank(user);
        vm.expectRevert(IBentoBoxRouter.NoLegsProvided.selector);
        router.splitSwap(address(bWETH), 1 ether, legs, block.timestamp + 1 hours);
    }

    function test_splitSwap_singleLegEdgeCase_100pct() public {
        uint256 amountIn = 1 ether;
        BasketLeg[] memory legs = new BasketLeg[](1);
        legs[0] = _leg(address(bUSDC), keyUsdc, 10_000, amountIn, 2000);

        uint256 usdcBefore = bUSDC.balanceOf(user);

        vm.prank(user);
        uint256[] memory amountsOut = router.splitSwap(address(bWETH), amountIn, legs, block.timestamp + 1 hours);

        assertEq(amountsOut.length, 1);
        assertGt(amountsOut[0], 0);
        assertEq(bUSDC.balanceOf(user) - usdcBefore, amountsOut[0]);
    }

    function test_splitSwap_roundingRemainderGoesToLastLeg() public {
        uint256 amountIn = 1 ether + 1; // deliberately not evenly divisible
        BasketLeg[] memory legs = new BasketLeg[](3);
        legs[0] = _leg(address(bUSDC), keyUsdc, 3333, 0, 2000);
        legs[1] = _leg(address(bDAI), keyDai, 3333, 0, 2000);
        legs[2] = _leg(address(bLINK), keyLink, 3334, 0, 15);
        // amountOutMinimum = 0 for all legs here — this test only checks input accounting,
        // not price, so we don't want an unrelated slippage revert.

        uint256 wethBefore = bWETH.balanceOf(user);

        vm.prank(user);
        router.splitSwap(address(bWETH), amountIn, legs, block.timestamp + 1 hours);

        // The full amountIn was pulled exactly once — no dust trapped in the router,
        // regardless of bps rounding across 3 legs.
        assertEq(bWETH.balanceOf(user), wethBefore - amountIn);
        assertEq(bWETH.balanceOf(address(router)), 0);
    }

    function test_splitSwap_revertsOnUnauthorizedCallback() public {
        vm.expectRevert(IBentoBoxRouter.NotPoolManager.selector);
        router.unlockCallback(bytes(""));
    }

    function test_splitSwap_revertsWhenAllowanceMissing() public {
        address noApprovalUser = makeAddr("noApprovalUser");
        bWETH.mint(noApprovalUser, 10 ether);

        BasketLeg[] memory legs = _threeWayLegs(1 ether);

        vm.prank(noApprovalUser);
        vm.expectRevert();
        router.splitSwap(address(bWETH), 1 ether, legs, block.timestamp + 1 hours);
    }
}
