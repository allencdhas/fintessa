"use client";

import { formatUnits } from "viem";
import { ExternalLink } from "lucide-react";

import { BASKET_TOKENS } from "@/config/contracts";
import type { SplitReceipt } from "@/hooks/useSplitSwap";

export function ReceiptSummary({ receipt }: { receipt: SplitReceipt }) {
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
      <a
        href={`https://basescan.org/tx/${receipt.splitTxHash}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        title="Explorer link only resolves on a real deployed chain (e.g. Base Sepolia) — this local Anvil tx hash won't be indexed there."
      >
        View transaction {receipt.splitTxHash.slice(0, 10)}… <ExternalLink className="size-3" />
      </a>
    </div>
  );
}
