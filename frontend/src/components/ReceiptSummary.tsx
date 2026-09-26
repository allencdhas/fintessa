"use client";

import { useChainId } from "wagmi";
import { formatUnits } from "viem";
import { ExternalLink } from "lucide-react";

import { BASKET_TOKENS } from "@/config/contracts";
import { explorerTxUrl } from "@/lib/explorer";
import type { SplitReceipt } from "@/hooks/useSplitSwap";

export function ReceiptSummary({ receipt }: { receipt: SplitReceipt }) {
  const chainId = useChainId();
  const explorerUrl = explorerTxUrl(chainId, receipt.splitTxHash);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <p className="text-sm font-medium">You received</p>
      <div className="space-y-2">
        {receipt.amountsOut.map(({ symbol, amountOut }) => {
          const token = BASKET_TOKENS.find((t) => t.symbol === symbol);
          return (
            <div key={symbol} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className={`size-2.5 rounded-full ${token?.colorClassName}`} />
                {symbol}
              </span>
              <span className="font-mono tabular-nums">
                {Number(formatUnits(amountOut, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </span>
            </div>
          );
        })}
      </div>
      {explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          View transaction {receipt.splitTxHash.slice(0, 10)}… <ExternalLink className="size-3" />
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">
          Tx {receipt.splitTxHash.slice(0, 10)}… (local Anvil chain — no block explorer)
        </p>
      )}
    </div>
  );
}
