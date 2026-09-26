"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";

import { v4QuoterAbi, type BasketTokenSymbol, type ChainDeployment, getPoolKeyForToken, getTokenAddress } from "@/config/contracts";

export type RebalanceQuoteSide = "sell" | "buy";

export type RebalanceQuoteLeg = {
  symbol: BasketTokenSymbol;
  /** "sell": amountIn is this token, quoted into the hub currency (bWETH).
   *  "buy": amountIn is the hub currency (bWETH), quoted into this token. */
  side: RebalanceQuoteSide;
  amountIn: bigint;
};

function quoteKey(side: RebalanceQuoteSide, symbol: BasketTokenSymbol) {
  return `${side}:${symbol}`;
}

/** Live on-chain quote preview for `rebalance` legs, in either direction — mirrors
 * `useBasketQuote`'s "real V4Quoter simulation, never a hardcoded price" approach. */
export function useRebalanceQuote(deployment: ChainDeployment | undefined, legs: RebalanceQuoteLeg[]) {
  const contracts = useMemo(() => {
    if (!deployment) return [];
    return legs
      .filter((leg) => leg.amountIn > 0n)
      .map((leg) => {
        const poolKey = getPoolKeyForToken(deployment, leg.symbol);
        const tokenAddress = getTokenAddress(deployment, leg.symbol);
        const tokenIsCurrency0 = poolKey.currency0.toLowerCase() === tokenAddress.toLowerCase();
        // sell: input currency is the token itself. buy: input currency is the hub (bWETH).
        const zeroForOne = leg.side === "sell" ? tokenIsCurrency0 : !tokenIsCurrency0;
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
              exactAmount: leg.amountIn,
              hookData: "0x" as const,
            },
          ],
          __key: quoteKey(leg.side, leg.symbol),
        };
      });
  }, [deployment, legs]);

  const { data, isLoading } = useReadContracts({
    contracts: contracts.map((c) => ({ address: c.address, abi: c.abi, functionName: c.functionName, args: c.args })),
    query: { enabled: contracts.length > 0 },
  });

  const quotes = useMemo(() => {
    const result: Partial<Record<string, bigint>> = {};
    if (!data) return result;
    data.forEach((entry, i) => {
      const key = contracts[i]?.__key;
      if (!key) return;
      if (entry.status === "success") {
        const [amountOut] = entry.result as readonly [bigint, bigint];
        result[key] = amountOut;
      }
    });
    return result;
  }, [data, contracts]);

  return {
    isLoading,
    getQuote: (side: RebalanceQuoteSide, symbol: BasketTokenSymbol) => quotes[quoteKey(side, symbol)],
  };
}
