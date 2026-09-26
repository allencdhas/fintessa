"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { parseAbiItem, type Address, type Hex } from "viem";

import { BASKET_TOKENS, getTokenAddress, type ChainDeployment, type BasketTokenSymbol } from "@/config/contracts";

const SPLIT_EXECUTED_EVENT = parseAbiItem(
  "event SplitExecuted(address indexed user, address indexed tokenIn, uint256 amountIn, address[] tokensOut, uint256[] amountsOut)"
);

export type SplitHistoryLeg = {
  symbol: BasketTokenSymbol | undefined;
  tokenAddress: Address;
  amountOut: bigint;
};

export type SplitHistoryItem = {
  txHash: Hex;
  blockNumber: bigint;
  timestamp?: number; // unix seconds
  amountIn: bigint;
  legs: SplitHistoryLeg[];
};

// Base Sepolia's public RPC (sepolia.base.org) hard-caps eth_getLogs to a 1,000-block range
// per call ("eth_getLogs is limited to a 1,000 range") — chunk to exactly that, and fetch
// chunks in parallel batches so a multi-day lookback doesn't mean dozens of sequential
// round-trips.
const CHUNK_BLOCKS = 1_000n;
const MAX_CHUNKS = 60; // ~60k blocks of lookback (~1.4 days at Base's ~2s block time)
const PARALLEL_BATCH = 10;

export function useSplitHistory(deployment: ChainDeployment | undefined) {
  const { address } = useAccount();
  const publicClient = usePublicClient();

  const fetchHistory = useCallback(async (): Promise<SplitHistoryItem[]> => {
    if (!deployment || !address || !publicClient) return [];

    const latest = await publicClient.getBlockNumber();
    const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
    let toBlock = latest;
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const fromBlock = toBlock > CHUNK_BLOCKS - 1n ? toBlock - CHUNK_BLOCKS + 1n : 0n;
      ranges.push({ fromBlock, toBlock });
      if (fromBlock === 0n) break;
      toBlock = fromBlock - 1n;
    }

    const collected: SplitHistoryItem[] = [];
    for (let i = 0; i < ranges.length; i += PARALLEL_BATCH) {
      const batch = ranges.slice(i, i + PARALLEL_BATCH);
      const results = await Promise.allSettled(
        batch.map((r) =>
          publicClient.getLogs({
            address: deployment.router,
            event: SPLIT_EXECUTED_EVENT,
            args: { user: address },
            fromBlock: r.fromBlock,
            toBlock: r.toBlock,
          })
        )
      );
      for (const result of results) {
        if (result.status !== "fulfilled") continue; // a single bad chunk shouldn't drop the rest of the history
        for (const l of result.value) {
          const { tokensOut, amountsOut, amountIn } = l.args;
          if (!tokensOut || !amountsOut || amountIn === undefined) continue;
          collected.push({
            txHash: l.transactionHash,
            blockNumber: l.blockNumber,
            amountIn,
            legs: tokensOut.map((tokenAddress, idx) => ({
              tokenAddress,
              amountOut: amountsOut[idx],
              symbol: BASKET_TOKENS.find((t) => getTokenAddress(deployment, t.symbol).toLowerCase() === tokenAddress.toLowerCase())?.symbol,
            })),
          });
        }
      }
    }

    const uniqueBlocks = [...new Set(collected.map((c) => c.blockNumber))];
    const blocks = await Promise.all(
      uniqueBlocks.map((bn) => publicClient.getBlock({ blockNumber: bn }).catch(() => undefined))
    );
    const timestamps = new Map(uniqueBlocks.map((bn, i) => [bn, blocks[i] ? Number(blocks[i]!.timestamp) : undefined]));

    collected.forEach((item) => {
      item.timestamp = timestamps.get(item.blockNumber);
    });
    collected.sort((a, b) => Number(b.blockNumber - a.blockNumber));
    return collected;
  }, [deployment, address, publicClient]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["split-history", deployment?.chainId, address],
    queryFn: fetchHistory,
    enabled: !!deployment && !!address && !!publicClient,
    refetchInterval: 20_000,
  });

  return { items: data ?? [], isLoading, refetch };
}
