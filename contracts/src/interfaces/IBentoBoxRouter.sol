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

interface IBentoBoxRouter {
    /// @notice Emitted once per successful split, with the per-leg output token and amount.
    event SplitExecuted(
        address indexed user,
        address indexed tokenIn,
        uint256 amountIn,
        address[] tokensOut,
        uint256[] amountsOut
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
}
