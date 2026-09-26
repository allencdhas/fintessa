// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "v4-core/src/types/PoolKey.sol";

/// @notice One leg of a basket split: swap `weightBps` of the total input into one output token.
struct BasketLeg {
    /// @dev Pool must be a direct pool between the split's tokenIn and this leg's output token.
    /// `hooks` must be `address(0)` — Bento Box is a plain router, it does not require a hook.
    PoolKey poolKey;
    /// @dev true if tokenIn == poolKey.currency0 (i.e. this leg swaps currency0 -> currency1)
    bool zeroForOne;
    /// @dev This leg's share of the total amountIn, out of 10_000 (basis points).
    /// All legs in a single `splitSwap` call must sum to exactly 10_000.
    uint16 weightBps;
    /// @dev Minimum acceptable output for this leg, computed off-chain from a quote.
    /// If the actual output is below this, the ENTIRE transaction reverts (all-or-nothing).
    uint128 amountOutMinimum;
    /// @dev Pass 0 to disable extra price-limit capping beyond `amountOutMinimum`.
    uint160 sqrtPriceLimitX96;
}

/// @notice One exact-input swap leg of a `rebalance` call. Unlike `BasketLeg`, the amount is
/// an explicit value (the caller already knows exactly how much of an existing holding is
/// over/under-weight) rather than a bps share of one shared input.
struct SwapLeg {
    /// @dev Pool must directly pair the swapped token with `hubToken`. `hooks` may be any
    /// address — a hooked pool is just another `PoolKey` to this router (see `SlippageExceeded`).
    PoolKey poolKey;
    /// @dev true if this leg's INPUT currency is poolKey.currency0.
    bool zeroForOne;
    /// @dev Exact amount of the leg's input currency to swap.
    uint256 amountIn;
    /// @dev Minimum acceptable output for this leg. If the actual output is below this — e.g.
    /// because a pool's (possibly dynamic-fee) hook charges up to 100% fee on this swap — the
    /// ENTIRE transaction reverts. This is the fail-safe: a malicious or compromised hook can
    /// make one leg return ~0, but it can never make the router accept less than the caller's
    /// own floor, and the all-or-nothing revert means no other leg executes either.
    uint128 amountOutMinimum;
    /// @dev Pass 0 to disable extra price-limit capping beyond `amountOutMinimum`.
    uint160 sqrtPriceLimitX96;
}

interface IBentoBoxRouter {
    /// @notice Emitted once per successful split, with the per-leg output token and amount.
    event SplitExecuted(
        address indexed user,
        address indexed tokenIn,
        uint256 amountIn,
        address[] tokensOut,
        uint256[] amountsOut
    );

    /// @notice Emitted once per successful rebalance, with the sold/bought tokens and amounts.
    event RebalanceExecuted(
        address indexed user,
        address indexed hubToken,
        address[] tokensSold,
        uint256[] amountsSold,
        address[] tokensBought,
        uint256[] amountsBought,
        int256 netHubDelta // positive: hub currency refunded to user; negative: pulled from user
    );

    error DeadlineExpired();
    error WeightsMustSumTo10000();
    error NoLegsProvided();
    error SlippageExceeded(uint256 legIndex, uint256 amountOut, uint256 amountOutMinimum);
    error NotPoolManager();
    error AlreadyUnlocked();

    /// @notice Split `amountIn` of `tokenIn` across `legs` in one atomic transaction.
    /// @dev Pulls `amountIn` of `tokenIn` from `msg.sender` (requires prior ERC-20 approval),
    /// swaps each leg against its own direct pool, and pushes each leg's output straight to
    /// `msg.sender`. Reverts the ENTIRE transaction if any leg's output is below its
    /// `amountOutMinimum`, or if `block.timestamp > deadline` — there is no partial-fill mode.
    /// @return amountsOut per-leg output amounts, in the same order as `legs`.
    function splitSwap(address tokenIn, uint256 amountIn, BasketLeg[] calldata legs, uint256 deadline)
        external
        returns (uint256[] memory amountsOut);

    /// @notice Rebalance an existing basket of holdings back toward target weights: sell some
    /// tokens for `hubToken`, then spend that `hubToken` buying others — all in one atomic
    /// transaction, using the same direct bWETH-paired pools `splitSwap` already routes
    /// through (bWETH is the "hub" every basket token has a pool against).
    /// @dev Every sell/buy leg's input token must be pre-approved to this router. The router
    /// nets the hub currency across all legs itself: if sells raised more hub currency than
    /// buys spent, the surplus is refunded to `msg.sender`; if buys need more than the sells
    /// raised, the shortfall is pulled from `msg.sender` (requires `hubToken` approval too).
    /// Reverts the ENTIRE transaction if any leg's output breaches its `amountOutMinimum` —
    /// including the case where a pool's hook has cranked its dynamic LP fee up to 100%,
    /// which would otherwise silently siphon the whole leg's value into the pool.
    /// @return soldAmountsOut hub currency received per sell leg, in the same order as `sellLegs`.
    /// @return boughtAmountsOut token amount received per buy leg, in the same order as `buyLegs`.
    function rebalance(address hubToken, SwapLeg[] calldata sellLegs, SwapLeg[] calldata buyLegs, uint256 deadline)
        external
        returns (uint256[] memory soldAmountsOut, uint256[] memory boughtAmountsOut);
}
