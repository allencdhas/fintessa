"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";

import { v4QuoterAbi, type BasketTokenSymbol, type ChainDeployment, getPoolKeyForToken, getTokenAddress } from "@/config/contracts";
import { TOTAL_BPS } from "@/lib/basket";

export type QuoteLeg = {
  symbol: BasketTokenSymbol;
  weightBps: number;
};

/**
 * Live, on-chain quote preview: hits `V4Quoter.quoteExactInputSingle` once per active leg
 * (a real `eth_call` simulation against the seeded pools), so the "≈ X token" preview the
 * user sees before signing reflects the pool's actual current price and depth — not a
 * hardcoded assumption.
 */
export function useBasketQuote(deployment: ChainDeployment | undefined, amountInWei: bigint | undefined, legs: QuoteLeg[]) {
  const wethAddress = deployment?.bWETH;

  const contracts = useMemo(() => {
    if (!deployment || !amountInWei || amountInWei <= 0n || legs.length === 0) return [];
    return legs.map((leg) => {
      const poolKey = getPoolKeyForToken(deployment, leg.symbol);
      const tokenAddress = getTokenAddress(deployment, leg.symbol);
      const zeroForOne = poolKey.currency0.toLowerCase() === (wethAddress ?? "").toLowerCase();
      const legAmountIn = (amountInWei * BigInt(leg.weightBps)) / BigInt(TOTAL_BPS);
      return {
        address: deployment.quoter,
        abi: v4QuoterAbi,
        functionName: "quoteExactInputSingle" as const,
        args: [
          {
            poolKey: {
              currency0: poolKey.currency0,
              currency1: poolKey.currency1,
              fee: poolKey.fee,
              tickSpacing: poolKey.tickSpacing,
              hooks: poolKey.hooks,
            },
            zeroForOne,
            exactAmount: legAmountIn,
            hookData: "0x" as const,
          },
        ],
        __symbol: leg.symbol,
        __tokenAddress: tokenAddress,
      };
    });
  }, [deployment, amountInWei, legs, wethAddress]);

  const { data, isLoading, isError } = useReadContracts({
    contracts: contracts.map((c) => ({
      address: c.address,
      abi: c.abi,
      functionName: c.functionName,
      args: c.args,
    })),
    query: { enabled: contracts.length > 0 },
  });

  const quotes = useMemo(() => {
    const result: Partial<Record<BasketTokenSymbol, bigint>> = {};
    if (!data) return result;
    data.forEach((entry, i) => {
      const symbol = contracts[i]?.__symbol;
      if (!symbol) return;
      if (entry.status === "success") {
        const [amountOut] = entry.result as readonly [bigint, bigint];
        result[symbol] = amountOut;
      }
    });
    return result;
  }, [data, contracts]);

  return { quotes, isLoading, isError };
}
