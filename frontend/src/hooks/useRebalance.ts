"use client";

import { useCallback, useRef, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { erc20Abi, formatUnits, parseEventLogs, type Address, type Hex } from "viem";

import { bentoBoxRouterAbi, type ChainDeployment, getPoolKeyForToken, getTokenAddress, type BasketTokenSymbol } from "@/config/contracts";
import type { SplitLogEntry, SplitLogLevel } from "@/hooks/useSplitSwap";

export type RebalanceStatus =
  | "idle"
  | "checking-allowances"
  | "awaiting-approve-signature"
  | "approving"
  | "awaiting-rebalance-signature"
  | "rebalancing"
  | "success"
  | "error";

export type RebalanceLegInput = {
  symbol: BasketTokenSymbol;
  amountIn: bigint;
  /** Quoted output for this leg, used to derive the on-chain slippage floor. */
  quotedAmountOut?: bigint;
};

export type RebalanceReceipt = {
  txHash: Hex;
  sold: { symbol: BasketTokenSymbol; amountOut: bigint }[];
  bought: { symbol: BasketTokenSymbol; amountOut: bigint }[];
  netHubDelta: bigint; // positive: hub currency refunded; negative: hub currency pulled
};

const SLIPPAGE_BPS = 500n; // 5%, matching useSplitSwap's default tolerance.

export function useRebalance(deployment: ChainDeployment | undefined) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [status, setStatus] = useState<RebalanceStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [receipt, setReceipt] = useState<RebalanceReceipt | null>(null);
  const [log, setLog] = useState<SplitLogEntry[]>([]);
  const logSeq = useRef(0);

  const appendLog = useCallback((level: SplitLogLevel, message: string, txHash?: Hex) => {
    logSeq.current += 1;
    setLog((prev) => [...prev, { id: `${Date.now()}-${logSeq.current}`, timestamp: Date.now(), level, message, txHash }]);
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setReceipt(null);
    setLog([]);
  }, []);

  const execute = useCallback(
    async (sellLegs: RebalanceLegInput[], buyLegs: RebalanceLegInput[], deadlineSeconds = 60 * 30) => {
      if (!deployment || !address || !publicClient) {
        setError(new Error("Wallet not connected"));
        setStatus("error");
        appendLog("error", "Wallet not connected.");
        return;
      }
      try {
        setError(null);
        setReceipt(null);
        setLog([]);
        setStatus("checking-allowances");
        appendLog("pending", "Checking allowances for the router…");

        // Every sold token needs its own allowance for exactly that leg's amountIn. The hub
        // currency (bWETH) also needs an allowance covering the full buy-side total, since a
        // shortfall (buys costing more hub currency than the sells raised) is pulled directly
        // from the caller and the exact shortfall isn't known until the swaps actually execute.
        const totalBuyHub = buyLegs.reduce((sum, l) => sum + l.amountIn, 0n);

        for (const leg of sellLegs) {
          const tokenAddress = getTokenAddress(deployment, leg.symbol);
          const allowance = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, deployment.router],
          });
          if (allowance < leg.amountIn) {
            appendLog("info", `Allowance insufficient for ${leg.symbol} — requesting approval.`);
            setStatus("awaiting-approve-signature");
            const approveTxHash = await writeContractAsync({
              address: tokenAddress,
              abi: erc20Abi,
              functionName: "approve",
              args: [deployment.router, leg.amountIn],
            });
            setStatus("approving");
            appendLog("pending", `Approving ${leg.symbol}, waiting for confirmation…`, approveTxHash);
            await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
            appendLog("success", `${leg.symbol} approved.`, approveTxHash);
          } else {
            appendLog("success", `${leg.symbol} allowance already sufficient.`);
          }
        }

        if (totalBuyHub > 0n) {
          const hubAllowance = await publicClient.readContract({
            address: deployment.bWETH,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, deployment.router],
          });
          if (hubAllowance < totalBuyHub) {
            appendLog("info", "bWETH allowance insufficient to cover a possible shortfall — requesting approval.");
            setStatus("awaiting-approve-signature");
            const approveTxHash = await writeContractAsync({
              address: deployment.bWETH,
              abi: erc20Abi,
              functionName: "approve",
              args: [deployment.router, totalBuyHub],
            });
            setStatus("approving");
            appendLog("pending", "Approving bWETH, waiting for confirmation…", approveTxHash);
            await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
            appendLog("success", "bWETH approved.", approveTxHash);
          } else {
            appendLog("success", "bWETH allowance already sufficient.");
          }
        }

        const toRouterLeg = (leg: RebalanceLegInput, side: "sell" | "buy") => {
          const poolKey = getPoolKeyForToken(deployment, leg.symbol);
          const tokenAddress = getTokenAddress(deployment, leg.symbol);
          const tokenIsCurrency0 = poolKey.currency0.toLowerCase() === tokenAddress.toLowerCase();
          const zeroForOne = side === "sell" ? tokenIsCurrency0 : !tokenIsCurrency0;
          const minOut = leg.quotedAmountOut !== undefined ? (leg.quotedAmountOut * (10_000n - SLIPPAGE_BPS)) / 10_000n : 0n;
          return {
            poolKey: {
              currency0: poolKey.currency0,
              currency1: poolKey.currency1,
              fee: poolKey.fee,
              tickSpacing: poolKey.tickSpacing,
              hooks: poolKey.hooks,
            },
            zeroForOne,
            amountIn: leg.amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,
          };
        };

        const routerSellLegs = sellLegs.map((l) => toRouterLeg(l, "sell"));
        const routerBuyLegs = buyLegs.map((l) => toRouterLeg(l, "buy"));
        const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

        setStatus("awaiting-rebalance-signature");
        appendLog(
          "pending",
          `Waiting for rebalance signature (${sellLegs.length} sell / ${buyLegs.length} buy leg${sellLegs.length + buyLegs.length === 1 ? "" : "s"})…`
        );
        const txHash = await writeContractAsync({
          address: deployment.router,
          abi: bentoBoxRouterAbi,
          functionName: "rebalance",
          args: [deployment.bWETH, routerSellLegs, routerBuyLegs, deadline],
        });

        setStatus("rebalancing");
        appendLog("pending", "Rebalance transaction submitted, waiting for confirmation…", txHash);
        const txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        const events = parseEventLogs({ abi: bentoBoxRouterAbi, eventName: "RebalanceExecuted", logs: txReceipt.logs });

        const sold: { symbol: BasketTokenSymbol; amountOut: bigint }[] = [];
        const bought: { symbol: BasketTokenSymbol; amountOut: bigint }[] = [];
        let netHubDelta = 0n;
        if (events.length > 0) {
          const { tokensSold, amountsSold, tokensBought, amountsBought, netHubDelta: net } = events[0].args as {
            tokensSold: readonly Address[];
            amountsSold: readonly bigint[];
            tokensBought: readonly Address[];
            amountsBought: readonly bigint[];
            netHubDelta: bigint;
          };
          netHubDelta = net;
          tokensSold.forEach((tokenAddress, i) => {
            const symbol = sellLegs.find((l) => getTokenAddress(deployment, l.symbol).toLowerCase() === tokenAddress.toLowerCase())?.symbol;
            if (symbol) sold.push({ symbol, amountOut: amountsSold[i] });
          });
          tokensBought.forEach((tokenAddress, i) => {
            const symbol = buyLegs.find((l) => getTokenAddress(deployment, l.symbol).toLowerCase() === tokenAddress.toLowerCase())?.symbol;
            if (symbol) bought.push({ symbol, amountOut: amountsBought[i] });
          });
        }

        const soldSummary = sold.map(({ symbol, amountOut }) => `${Number(formatUnits(amountOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`).join(", ");
        const boughtSummary = bought.map(({ symbol, amountOut }) => `${Number(formatUnits(amountOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`).join(", ");
        const hubNote =
          netHubDelta > 0n
            ? ` bWETH surplus of ${Number(formatUnits(netHubDelta, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} refunded.`
            : netHubDelta < 0n
              ? ` bWETH shortfall of ${Number(formatUnits(-netHubDelta, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} pulled.`
              : "";
        appendLog(
          "success",
          `Rebalance confirmed — sold ${soldSummary || "nothing"}, bought ${boughtSummary || "nothing"}.${hubNote} All legs settled atomically.`,
          txHash
        );

        setReceipt({ txHash, sold, bought, netHubDelta });
        setStatus("success");
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        setStatus("error");
        appendLog("error", err.message);
      }
    },
    [deployment, address, publicClient, writeContractAsync, appendLog]
  );

  return { execute, reset, status, error, receipt, log };
}
