"use client";

import { useChainId } from "wagmi";
import { formatUnits } from "viem";
import { ArrowRight, ExternalLink, Loader2 } from "lucide-react";

import { explorerTxUrl } from "@/lib/explorer";
import { timeAgo } from "@/lib/time";
import type { SplitHistoryItem } from "@/hooks/useSplitHistory";

function fmt(amount: bigint) {
  return Number(formatUnits(amount, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function SplitHistoryList({ items, isLoading }: { items: SplitHistoryItem[]; isLoading: boolean }) {
  const chainId = useChainId();

  if (isLoading && items.length === 0) {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading history…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border py-10 text-center">
        <p className="text-sm text-muted-foreground">No splits yet</p>
        <p className="text-xs text-muted-foreground/70">Your past splits will show up here.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {items.map((item) => {
        const url = explorerTxUrl(chainId, item.txHash);
        return (
          <div key={item.txHash} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="size-2.5 rounded-full bg-zinc-500" />
                {fmt(item.amountIn)} bWETH
              </span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
              <div className="flex flex-wrap items-center gap-1.5">
                {item.legs.map((leg) => (
                  <span
                    key={leg.tokenAddress}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    {fmt(leg.amountOut)} {leg.symbol ?? "?"}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{timeAgo(item.timestamp)}</span>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono hover:text-foreground">
                  {item.txHash.slice(0, 8)}… <ExternalLink className="size-3" />
                </a>
              ) : (
                <span className="font-mono">{item.txHash.slice(0, 8)}…</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
