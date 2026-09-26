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

import {IBentoBoxRouter, BasketLeg, SwapLeg} from "./interfaces/IBentoBoxRouter.sol";

/// @title BentoBoxRouter
/// @notice A Uniswap v4 periphery router (NOT a hook) that (1) splits one input token into a
/// fixed basket of output tokens, and (2) rebalances an existing basket back toward target
/// weights — both atomically, in a single transaction each, via one loop of
/// `poolManager.swap()` calls inside one `unlock()`, settling only the net currency deltas
/// via v4's flash accounting.
///
/// Scope:
///  - Direct pools only, no multi-hop / no path-finding. `rebalance` treats one token (the
///    "hub", e.g. bWETH) as the common intermediary every other basket token is paired
///    against — selling token A and buying token B is really "A -> hub" then "hub -> B",
///    exactly like `splitSwap`'s own pools, just composed twice in one transaction.
///  - All-or-nothing revert: any leg breaching its per-leg `amountOutMinimum` reverts the
///    whole transaction. There is no partial-fill / best-effort mode. This is also the
///    router's fail-safe against a malicious or compromised pool hook: v4 lets a pool's hook
///    override its LP fee up to 100% (`LPFeeLibrary.MAX_LP_FEE`) on every swap. If a hook
///    does that right as a leg executes, that leg's output collapses toward zero, breaches
///    its `amountOutMinimum`, and the ENTIRE transaction reverts — including every other,
///    perfectly healthy leg. The caller gets their full original holdings back, never a
///    partially-executed, hook-drained basket.
///  - Weights, amounts, and slippage bounds are supplied by the caller on every call — the
///    contract is stateless, there is no on-chain notion of a named/registered basket or
///    position.
contract BentoBoxRouter is IBentoBoxRouter, IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable poolManager;

    uint256 private constant TOTAL_BPS = 10_000;

    enum ActionType {
        Split,
        Rebalance
    }

    struct SplitCallbackData {
        address sender;
        address tokenIn;
        uint256 amountIn;
        BasketLeg[] legs;
    }

    struct RebalanceCallbackData {
        address sender;
        address hubToken;
        SwapLeg[] sellLegs;
        SwapLeg[] buyLegs;
    }

    function _decodeRebalanceCallbackData(bytes memory inner) internal pure returns (RebalanceCallbackData memory cb) {
        (cb.sender, cb.hubToken, cb.sellLegs, cb.buyLegs) = abi.decode(inner, (address, address, SwapLeg[], SwapLeg[]));
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

        bytes memory result = poolManager.unlock(
            abi.encode(ActionType.Split, abi.encode(SplitCallbackData(msg.sender, tokenIn, amountIn, legs)))
        );
        amountsOut = abi.decode(result, (uint256[]));

        address[] memory tokensOut = new address[](legs.length);
        for (uint256 i = 0; i < legs.length; i++) {
            tokensOut[i] = legs[i].zeroForOne ? Currency.unwrap(legs[i].poolKey.currency1) : Currency.unwrap(legs[i].poolKey.currency0);
        }
        emit SplitExecuted(msg.sender, tokenIn, amountIn, tokensOut, amountsOut);
    }

    /// @inheritdoc IBentoBoxRouter
    function rebalance(address hubToken, SwapLeg[] calldata sellLegs, SwapLeg[] calldata buyLegs, uint256 deadline)
        external
        returns (uint256[] memory soldAmountsOut, uint256[] memory boughtAmountsOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (sellLegs.length == 0 && buyLegs.length == 0) revert NoLegsProvided();

        bytes memory result = poolManager.unlock(
            abi.encode(ActionType.Rebalance, abi.encode(msg.sender, hubToken, sellLegs, buyLegs))
        );
        int256 netHubDelta;
        (soldAmountsOut, boughtAmountsOut, netHubDelta) = abi.decode(result, (uint256[], uint256[], int256));

        address[] memory tokensSold = new address[](sellLegs.length);
        for (uint256 i = 0; i < sellLegs.length; i++) {
            tokensSold[i] = _inputToken(sellLegs[i]);
        }
        address[] memory tokensBought = new address[](buyLegs.length);
        for (uint256 i = 0; i < buyLegs.length; i++) {
            tokensBought[i] = _outputToken(buyLegs[i]);
        }
        emit RebalanceExecuted(msg.sender, hubToken, tokensSold, soldAmountsOut, tokensBought, boughtAmountsOut, netHubDelta);
    }

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();

        (ActionType action, bytes memory inner) = abi.decode(data, (ActionType, bytes));
        if (action == ActionType.Split) {
            return _handleSplit(abi.decode(inner, (SplitCallbackData)));
        }
        return _handleRebalance(_decodeRebalanceCallbackData(inner));
    }

    function _handleSplit(SplitCallbackData memory cb) internal returns (bytes memory) {
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

            BalanceDelta delta = poolManager.swap(
                leg.poolKey,
                SwapParams({
                    zeroForOne: leg.zeroForOne,
                    amountSpecified: -int256(legAmountIn), // exact input
                    sqrtPriceLimitX96: _defaultPriceLimit(leg.zeroForOne, leg.sqrtPriceLimitX96)
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

    function _executeSwapLeg(SwapLeg memory leg, uint256 legIndex) internal returns (uint256 amountOut) {
        BalanceDelta delta = poolManager.swap(
            leg.poolKey,
            SwapParams({
                zeroForOne: leg.zeroForOne,
                amountSpecified: -int256(leg.amountIn),
                sqrtPriceLimitX96: _defaultPriceLimit(leg.zeroForOne, leg.sqrtPriceLimitX96)
            }),
            bytes("")
        );
        amountOut = leg.zeroForOne ? uint256(uint128(delta.amount1())) : uint256(uint128(delta.amount0()));
        if (amountOut < leg.amountOutMinimum) revert SlippageExceeded(legIndex, amountOut, leg.amountOutMinimum);
    }

    // NOTE: this is split into several small internal functions (rather than one large
    // function body) to work around what appears to be a solc/via-ir codegen limit — an
    // equivalent single-function version reproducibly hit an internal compiler error
    // ("Assembly exception for bytecode") at this optimizer configuration, confirmed by
    // bisection. Splitting the phases out avoids it; the logic itself is unchanged.
    function _handleRebalance(RebalanceCallbackData memory cb) internal returns (bytes memory) {
        (uint256[] memory soldOut, address[] memory soldTokens, uint256 hubReceived) = _sellPhase(cb.sellLegs);
        (uint256[] memory boughtOut, address[] memory boughtTokens, uint256 hubSpent) =
            _buyPhase(cb.buyLegs, cb.sellLegs.length);

        // Settle each sold token once, for exactly what that leg pulled from the caller.
        _settleSoldTokens(cb.sender, cb.sellLegs, soldTokens);

        // Net the hub currency ONCE across both phases: refund a surplus, or pull a shortfall
        // straight from the caller (requires the caller to have approved the hub token too).
        int256 netHubDelta = int256(hubReceived) - int256(hubSpent);
        _settleHub(cb.sender, cb.hubToken, netHubDelta);

        // Take each bought token once, straight to the original caller.
        _takeBoughtTokens(cb.sender, boughtTokens, boughtOut);

        return abi.encode(soldOut, boughtOut, netHubDelta);
    }

    /// @dev Phase 1: sell every over-weight token into the hub currency.
    function _sellPhase(SwapLeg[] memory sellLegs)
        internal
        returns (uint256[] memory soldOut, address[] memory soldTokens, uint256 hubReceived)
    {
        uint256 n = sellLegs.length;
        soldOut = new uint256[](n);
        soldTokens = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            soldTokens[i] = _inputToken(sellLegs[i]);
            soldOut[i] = _executeSwapLeg(sellLegs[i], i);
            hubReceived += soldOut[i];
        }
    }

    /// @dev Phase 2: spend hub currency buying every under-weight token. `legIndexOffset` is
    /// the number of sell legs, so `SlippageExceeded`'s leg index lines up with the caller's
    /// combined `sellLegs ++ buyLegs` view.
    function _buyPhase(SwapLeg[] memory buyLegs, uint256 legIndexOffset)
        internal
        returns (uint256[] memory boughtOut, address[] memory boughtTokens, uint256 hubSpent)
    {
        uint256 n = buyLegs.length;
        boughtOut = new uint256[](n);
        boughtTokens = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            boughtTokens[i] = _outputToken(buyLegs[i]);
            boughtOut[i] = _executeSwapLeg(buyLegs[i], legIndexOffset + i);
            hubSpent += buyLegs[i].amountIn;
        }
    }

    function _settleSoldTokens(address sender, SwapLeg[] memory sellLegs, address[] memory soldTokens) internal {
        for (uint256 i = 0; i < sellLegs.length; i++) {
            Currency c = Currency.wrap(soldTokens[i]);
            poolManager.sync(c);
            IERC20(soldTokens[i]).safeTransferFrom(sender, address(poolManager), sellLegs[i].amountIn);
            poolManager.settle();
        }
    }

    function _settleHub(address sender, address hubToken, int256 netHubDelta) internal {
        Currency hub = Currency.wrap(hubToken);
        if (netHubDelta < 0) {
            poolManager.sync(hub);
            IERC20(hubToken).safeTransferFrom(sender, address(poolManager), uint256(-netHubDelta));
            poolManager.settle();
        } else if (netHubDelta > 0) {
            poolManager.take(hub, sender, uint256(netHubDelta));
        }
    }

    function _takeBoughtTokens(address sender, address[] memory boughtTokens, uint256[] memory boughtOut) internal {
        for (uint256 i = 0; i < boughtTokens.length; i++) {
            poolManager.take(Currency.wrap(boughtTokens[i]), sender, boughtOut[i]);
        }
    }

    function _inputToken(SwapLeg memory leg) internal pure returns (address) {
        return leg.zeroForOne ? Currency.unwrap(leg.poolKey.currency0) : Currency.unwrap(leg.poolKey.currency1);
    }

    function _outputToken(SwapLeg memory leg) internal pure returns (address) {
        return leg.zeroForOne ? Currency.unwrap(leg.poolKey.currency1) : Currency.unwrap(leg.poolKey.currency0);
    }

    /// @dev A leg's `amountOutMinimum` is the real slippage guard; `sqrtPriceLimitX96 == 0`
    /// just means "don't additionally cap the price" and gets mapped to the
    /// direction-appropriate open-ended bound v4 requires in that case.
    function _defaultPriceLimit(bool zeroForOne, uint160 sqrtPriceLimitX96) internal pure returns (uint160) {
        if (sqrtPriceLimitX96 != 0) return sqrtPriceLimitX96;
        return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
    }

    function _validateWeights(BasketLeg[] calldata legs) internal pure {
        uint256 sum = 0;
        for (uint256 i = 0; i < legs.length; i++) {
            sum += legs[i].weightBps;
        }
        if (sum != TOTAL_BPS) revert WeightsMustSumTo10000();
    }
}
