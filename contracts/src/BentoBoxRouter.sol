// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

import {IBentoBoxRouter, BasketLeg} from "./interfaces/IBentoBoxRouter.sol";

/// @title BentoBoxRouter
/// @notice A Uniswap v4 periphery router (NOT a hook) that splits one input token into a
/// fixed basket of output tokens, atomically, in a single transaction — one loop of
/// `poolManager.swap()` calls inside one `unlock()`, settling the input once and taking
/// each output once via v4's flash accounting.
///
/// Scope (see docs/bento-box-build-plan.md for the full rationale):
///  - Direct pools only, no multi-hop / no path-finding.
///  - All-or-nothing revert: any leg breaching its per-leg `amountOutMinimum` reverts the
///    whole transaction. There is no partial-fill / best-effort mode.
///  - Basket weights and slippage bounds are supplied by the caller on every call — the
///    contract is stateless, there is no on-chain notion of a named/registered basket.
contract BentoBoxRouter is IBentoBoxRouter, IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;

    uint256 private constant TOTAL_BPS = 10_000;

    struct CallbackData {
        address sender;
        address tokenIn;
        uint256 amountIn;
        BasketLeg[] legs;
    }

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    /// @inheritdoc IBentoBoxRouter
    function splitSwap(address tokenIn, uint256 amountIn, BasketLeg[] calldata legs, uint256 deadline)
        external
        returns (uint256[] memory amountsOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (legs.length == 0) revert NoLegsProvided();
        _validateWeights(legs);

        // Pull the full input once, up front, from the caller.
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        bytes memory result = poolManager.unlock(abi.encode(CallbackData(msg.sender, tokenIn, amountIn, legs)));
        amountsOut = abi.decode(result, (uint256[]));

        address[] memory tokensOut = new address[](legs.length);
        for (uint256 i = 0; i < legs.length; i++) {
            tokensOut[i] = legs[i].zeroForOne ? Currency.unwrap(legs[i].poolKey.currency1) : Currency.unwrap(legs[i].poolKey.currency0);
        }
        emit SplitExecuted(msg.sender, tokenIn, amountIn, tokensOut, amountsOut);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        CallbackData memory cb = abi.decode(data, (CallbackData));
        uint256 nLegs = cb.legs.length;
        uint256[] memory amountsOut = new uint256[](nLegs);
        uint256 allocated = 0;

        for (uint256 i = 0; i < nLegs; i++) {
            BasketLeg memory leg = cb.legs[i];

            // The last leg absorbs any rounding remainder from bps division so the legs'
            // input amounts always sum exactly to `amountIn` — no dust left in the router.
            uint256 legAmountIn =
                (i == nLegs - 1) ? cb.amountIn - allocated : (cb.amountIn * leg.weightBps) / TOTAL_BPS;
            allocated += legAmountIn;

            // A leg's `amountOutMinimum` is the real slippage guard; `sqrtPriceLimitX96 == 0`
            // just means "don't additionally cap the price" and gets mapped to the
            // direction-appropriate open-ended bound v4 requires in that case.
            uint160 priceLimit = leg.sqrtPriceLimitX96 != 0
                ? leg.sqrtPriceLimitX96
                : (leg.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1);

            BalanceDelta delta = poolManager.swap(
                leg.poolKey,
                SwapParams({
                    zeroForOne: leg.zeroForOne,
                    amountSpecified: -int256(legAmountIn), // exact input
                    sqrtPriceLimitX96: priceLimit
                }),
                bytes("")
            );

            // Exact-input swap: the input-side delta is negative (paid by the swapper) and
            // the output-side delta is positive (owed to the swapper) — take the positive
            // (output) side directly, with no negation.
            uint256 amountOut = leg.zeroForOne ? uint256(uint128(delta.amount1())) : uint256(uint128(delta.amount0()));

            if (amountOut < leg.amountOutMinimum) {
                revert SlippageExceeded(i, amountOut, leg.amountOutMinimum);
            }
            amountsOut[i] = amountOut;
        }

        // Settle the input currency once, for the full amount actually consumed across all legs.
        Currency tokenInCurrency = Currency.wrap(cb.tokenIn);
        poolManager.sync(tokenInCurrency);
        IERC20(cb.tokenIn).safeTransfer(address(poolManager), cb.amountIn);
        poolManager.settle();

        // Take each leg's output currency once, straight to the original caller.
        for (uint256 i = 0; i < nLegs; i++) {
            Currency outCcy =
                cb.legs[i].zeroForOne ? cb.legs[i].poolKey.currency1 : cb.legs[i].poolKey.currency0;
            poolManager.take(outCcy, cb.sender, amountsOut[i]);
        }

        return abi.encode(amountsOut);
    }

    function _validateWeights(BasketLeg[] calldata legs) internal pure {
        uint256 sum = 0;
        for (uint256 i = 0; i < legs.length; i++) {
            sum += legs[i].weightBps;
        }
        if (sum != TOTAL_BPS) revert WeightsMustSumTo10000();
    }
}
