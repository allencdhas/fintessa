"use client";

import { useCallback, useRef, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { erc20Abi, formatUnits, parseEventLogs, type Address, type Hex } from "viem";

import { bentoBoxRouterAbi, type ChainDeployment, getPoolKeyForToken, getTokenAddress, type BasketTokenSymbol } from "@/config/contracts";
import { TOTAL_BPS } from "@/lib/basket";

export type SplitSwapStatus =
  | "idle"
  | "checking-allowance"
  | "awaiting-approve-signature"
  | "approving"
  | "awaiting-split-signature"
  | "splitting"
  | "success"
  | "error";

export type SplitSwapLeg = {
  symbol: BasketTokenSymbol;
  weightBps: number;
  /** Quoted amountOut for this leg (from useBasketQuote), used to derive the on-chain
   * slippage floor. If undefined, the leg is sent with `amountOutMinimum = 0` (no
   * protection) — the UI should avoid letting a user submit without a quote. */
  quotedAmountOut?: bigint;
};

export type SplitReceipt = {
  approveTxHash?: Hex;
  splitTxHash: Hex;
  amountsOut: { symbol: BasketTokenSymbol; amountOut: bigint }[];
};

export type SplitLogLevel = "info" | "pending" | "success" | "error";

export type SplitLogEntry = {
  id: string;
  timestamp: number;
  level: SplitLogLevel;
  message: string;
  txHash?: Hex;
};

const SLIPPAGE_BPS = 500n; // 5% default tolerance — generous on purpose (see build plan §2).

export function useSplitSwap(deployment: ChainDeployment | undefined) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [status, setStatus] = useState<SplitSwapStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [receipt, setReceipt] = useState<SplitReceipt | null>(null);
  const [log, setLog] = useState<SplitLogEntry[]>([]);
  const logSeq = useRef(0);

  const appendLog = useCallback((level: SplitLogLevel, message: string, txHash?: Hex) => {
    logSeq.current += 1;
    const entry: SplitLogEntry = { id: `${Date.now()}-${logSeq.current}`, timestamp: Date.now(), level, message, txHash };
    setLog((prev) => [...prev, entry]);
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setReceipt(null);
    setLog([]);
  }, []);

  const execute = useCallback(
    async (amountInWei: bigint, legs: SplitSwapLeg[], deadlineSeconds = 60 * 30) => {
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
        setStatus("checking-allowance");
        appendLog("pending", "Checking current bWETH allowance for the router…");

        const allowance = await publicClient.readContract({
          address: deployment.bWETH,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, deployment.router],
        });

        let approveTxHash: Hex | undefined;
        if (allowance < amountInWei) {
          appendLog("info", `Allowance insufficient (${formatUnits(allowance, 18)} < ${formatUnits(amountInWei, 18)}) — requesting approval.`);
          setStatus("awaiting-approve-signature");
          appendLog("pending", "Waiting for approve signature in wallet…");
          approveTxHash = await writeContractAsync({
            address: deployment.bWETH,
            abi: erc20Abi,
            functionName: "approve",
            args: [deployment.router, amountInWei],
          });
          setStatus("approving");
          appendLog("pending", "Approve transaction submitted, waiting for confirmation…", approveTxHash);
          await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
          appendLog("success", "Approval confirmed.", approveTxHash);
        } else {
          appendLog("success", "Allowance already sufficient — skipping approval.");
        }

        const routerLegs = legs.map((leg) => {
          const poolKey = getPoolKeyForToken(deployment, leg.symbol);
          const zeroForOne = poolKey.currency0.toLowerCase() === deployment.bWETH.toLowerCase();
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
            weightBps: leg.weightBps,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,
          };
        });

        const totalBps = legs.reduce((sum, l) => sum + l.weightBps, 0);
        if (totalBps !== TOTAL_BPS) {
          throw new Error(`Basket weights must sum to 100% (got ${(totalBps / 100).toFixed(2)}%)`);
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

        setStatus("awaiting-split-signature");
        appendLog("pending", `Waiting for split signature (${legs.length} leg${legs.length === 1 ? "" : "s"})…`);
        const splitTxHash = await writeContractAsync({
          address: deployment.router,
          abi: bentoBoxRouterAbi,
          functionName: "splitSwap",
          args: [deployment.bWETH, amountInWei, routerLegs, deadline],
        });

        setStatus("splitting");
        appendLog("pending", "Split transaction submitted, waiting for confirmation…", splitTxHash);
        const splitReceipt = await publicClient.waitForTransactionReceipt({ hash: splitTxHash });

        const events = parseEventLogs({
          abi: bentoBoxRouterAbi,
          eventName: "SplitExecuted",
          logs: splitReceipt.logs,
        });

        const amountsOut: { symbol: BasketTokenSymbol; amountOut: bigint }[] = [];
        if (events.length > 0) {
          const { tokensOut, amountsOut: outs } = events[0].args as {
            tokensOut: readonly Address[];
            amountsOut: readonly bigint[];
          };
          tokensOut.forEach((tokenAddress, i) => {
            const symbol = legs.find((l) => getTokenAddress(deployment, l.symbol).toLowerCase() === tokenAddress.toLowerCase())?.symbol;
            if (symbol) amountsOut.push({ symbol, amountOut: outs[i] });
          });
        }

        const summary = amountsOut.map(({ symbol, amountOut }) => `${Number(formatUnits(amountOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`).join(", ");
        appendLog("success", `Split confirmed — received ${summary || "basket"}. All legs settled atomically.`, splitTxHash);

        setReceipt({ approveTxHash, splitTxHash, amountsOut });
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
