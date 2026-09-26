"use client";

import { useEffect, useMemo, useState } from "react";
import { parseUnits, formatUnits } from "viem";
import { Plus } from "lucide-react";

import { AmountInput } from "@/components/AmountInput";
import { BasketAllocator, REQUIRED_TOKENS, STRETCH_TOKEN } from "@/components/BasketAllocator";
import { ApproveAndSplitButton } from "@/components/ApproveAndSplitButton";
import { ProgressLog } from "@/components/ProgressLog";
import { ReceiptSummary } from "@/components/ReceiptSummary";
import { FaucetPanel } from "@/components/FaucetPanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

import { useBasketQuote } from "@/hooks/useBasketQuote";
import { useSplitSwap } from "@/hooks/useSplitSwap";
import { BASKET_TOKENS, type ChainDeployment, type BasketTokenSymbol } from "@/config/contracts";
import { evenSplit, isValidAllocation, type BasketAllocation } from "@/lib/basket";

export function NewSplitDialog({ deployment, onSplitConfirmed }: { deployment: ChainDeployment; onSplitConfirmed: () => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<BasketTokenSymbol[]>(REQUIRED_TOKENS);
  const [weights, setWeights] = useState<BasketAllocation>(evenSplit(REQUIRED_TOKENS));
  const [amountInStr, setAmountInStr] = useState("0.3");

  const amountInWei = useMemo(() => {
    try {
      return amountInStr ? parseUnits(amountInStr, 18) : undefined;
    } catch {
      return undefined;
    }
  }, [amountInStr]);

  const legsForQuote = useMemo(() => active.map((symbol) => ({ symbol, weightBps: weights[symbol] ?? 0 })), [active, weights]);
  const { quotes, isLoading: quoteLoading } = useBasketQuote(deployment, amountInWei, legsForQuote);
  const { execute, status, receipt, reset, log } = useSplitSwap(deployment);

  useEffect(() => {
    if (status === "success") onSplitConfirmed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function toggleStretchToken(enabled: boolean) {
    const nextActive = enabled ? [...REQUIRED_TOKENS, STRETCH_TOKEN] : REQUIRED_TOKENS;
    setActive(nextActive);
    setWeights(evenSplit(nextActive));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      reset();
      setAmountInStr("0.3");
      setActive(REQUIRED_TOKENS);
      setWeights(evenSplit(REQUIRED_TOKENS));
    }
  }

  const validAllocation = isValidAllocation(weights, active);
  const hasAmount = amountInWei !== undefined && amountInWei > 0n;
  const isBusy = status !== "idle" && status !== "success" && status !== "error";

  async function handleSplit() {
    if (!amountInWei) return;
    // A leg at exactly 0% still reaches the pool as a zero-amount swap, which v4's
    // PoolManager hard-reverts on (SwapAmountCannotBeZero) — drop it instead. Dropping a
    // 0-weight leg never breaks the "must sum to 10,000" invariant, since the remaining
    // legs already account for the full 100% between them.
    await execute(
      amountInWei,
      active
        .map((symbol) => ({ symbol, weightBps: weights[symbol] ?? 0, quotedAmountOut: quotes[symbol] }))
        .filter((leg) => leg.weightBps > 0)
    );
  }

  let disabledReason: string | undefined;
  if (!hasAmount) disabledReason = "Enter an amount to split.";
  else if (!validAllocation) disabledReason = "Basket weights must sum to 100%.";
  else if (quoteLoading) disabledReason = "Fetching live quote…";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="rounded-full">
          <Plus className="size-4" /> New Split
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="flex flex-row items-start justify-between gap-4 pr-6">
          <div>
            <DialogTitle>New split</DialogTitle>
            <DialogDescription>One input token, a fixed basket of outputs, settled atomically.</DialogDescription>
          </div>
          <FaucetPanel deployment={deployment} />
        </DialogHeader>

        {log.length === 0 ? (
          <div className="space-y-5">
            <AmountInput value={amountInStr} onChange={setAmountInStr} wethAddress={deployment.bWETH} />
            <p className="-mt-3 text-xs text-muted-foreground">
              This single bWETH amount is what gets divided below — it isn&apos;t added again per token.
            </p>

            <Separator />

            <div className="space-y-3">
              <p className="text-sm font-medium">Splits into</p>
              <BasketAllocator active={active} weights={weights} onChange={setWeights} onToggleStretchToken={toggleStretchToken} />
            </div>

            <Separator />

            <div className="space-y-2">
              <p className="text-sm font-medium">
                You&apos;ll receive (estimated) — from that {hasAmount ? amountInStr : "…"} bWETH split {active.length} ways
              </p>
              {active.map((symbol) => {
                const token = BASKET_TOKENS.find((t) => t.symbol === symbol)!;
                const quoted = quotes[symbol];
                return (
                  <div key={symbol} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span className={`size-2.5 rounded-full ${token.colorClassName}`} />
                      {symbol}
                    </span>
                    <span className="font-mono tabular-nums">
                      {hasAmount ? (quoted !== undefined ? `≈ ${Number(formatUnits(quoted, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "…") : "—"}
                    </span>
                  </div>
                );
              })}
            </div>

            <ApproveAndSplitButton
              onClick={handleSplit}
              status={status}
              disabled={!!disabledReason}
              disabledReason={disabledReason}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <ProgressLog entries={log} />
            {status === "success" && receipt && <ReceiptSummary receipt={receipt} />}
            {!isBusy && (
              <Button variant="outline" className="w-full" onClick={() => handleOpenChange(false)}>
                {status === "success" ? "Done" : "Close"}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
