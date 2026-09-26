"use client";

import { useMemo, useState } from "react";
import { useAccount, useBalance } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ProgressLog } from "@/components/ProgressLog";

import { useRebalance, type RebalanceLegInput } from "@/hooks/useRebalance";
import { useRebalanceQuote, type RebalanceQuoteLeg } from "@/hooks/useRebalanceQuote";
import { BASKET_TOKENS, getTokenAddress, type ChainDeployment, type BasketTokenSymbol } from "@/config/contracts";

const ALL_TOKENS: BasketTokenSymbol[] = ["bUSDC", "bDAI", "bLINK", "bUNI"];

function fmt(amount: bigint) {
  return Number(formatUnits(amount, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function AmountRow({
  symbol,
  value,
  onChange,
  suffix,
  balance,
}: {
  symbol: BasketTokenSymbol;
  value: string;
  onChange: (v: string) => void;
  suffix: string;
  balance?: string;
}) {
  const token = BASKET_TOKENS.find((t) => t.symbol === symbol)!;
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-20 shrink-0 items-center gap-1.5 text-sm">
        <span className={`size-2.5 rounded-full ${token.colorClassName}`} />
        {symbol}
      </span>
      <Input
        inputMode="decimal"
        placeholder="0.0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
      />
      <span className="w-10 shrink-0 text-xs text-muted-foreground">{suffix}</span>
      {balance && <span className="w-24 shrink-0 truncate text-right text-xs text-muted-foreground">bal {balance}</span>}
    </div>
  );
}

export function RebalancePanel({ deployment, onRebalanceConfirmed }: { deployment: ChainDeployment; onRebalanceConfirmed: () => void }) {
  const { address } = useAccount();
  const [sellStr, setSellStr] = useState<Partial<Record<BasketTokenSymbol, string>>>({});
  const [buyStr, setBuyStr] = useState<Partial<Record<BasketTokenSymbol, string>>>({});

  const { execute, status, receipt, log, reset } = useRebalance(deployment);
  const isBusy = status !== "idle" && status !== "success" && status !== "error";

  const parsed = useMemo(() => {
    const toLeg = (map: Partial<Record<BasketTokenSymbol, string>>): RebalanceLegInput[] =>
      ALL_TOKENS.flatMap((symbol) => {
        const raw = map[symbol];
        if (!raw) return [];
        try {
          const amountIn = parseUnits(raw, 18);
          return amountIn > 0n ? [{ symbol, amountIn }] : [];
        } catch {
          return [];
        }
      });
    return { sellLegs: toLeg(sellStr), buyLegs: toLeg(buyStr) };
  }, [sellStr, buyStr]);

  const quoteLegs = useMemo<RebalanceQuoteLeg[]>(
    () => [
      ...parsed.sellLegs.map((l) => ({ symbol: l.symbol, side: "sell" as const, amountIn: l.amountIn })),
      ...parsed.buyLegs.map((l) => ({ symbol: l.symbol, side: "buy" as const, amountIn: l.amountIn })),
    ],
    [parsed]
  );
  const { getQuote, isLoading: quoteLoading } = useRebalanceQuote(deployment, quoteLegs);

  const hasLegs = parsed.sellLegs.length > 0 || parsed.buyLegs.length > 0;
  const sellHubTotal = parsed.sellLegs.reduce((sum, l) => sum + (getQuote("sell", l.symbol) ?? 0n), 0n);
  const buyHubTotal = parsed.buyLegs.reduce((sum, l) => sum + l.amountIn, 0n);
  const allQuotesReady =
    parsed.sellLegs.every((l) => getQuote("sell", l.symbol) !== undefined) &&
    parsed.buyLegs.every((l) => getQuote("buy", l.symbol) !== undefined);

  let disabledReason: string | undefined;
  if (!hasLegs) disabledReason = "Enter at least one sell or buy amount.";
  else if (quoteLoading || !allQuotesReady) disabledReason = "Fetching live quote…";

  async function handleRebalance() {
    const sellLegs = parsed.sellLegs.map((l) => ({ ...l, quotedAmountOut: getQuote("sell", l.symbol) }));
    const buyLegs = parsed.buyLegs.map((l) => ({ ...l, quotedAmountOut: getQuote("buy", l.symbol) }));

    const sellDesc = sellLegs.map((l) => `${fmt(l.amountIn)} ${l.symbol}`).join(", ");
    const buyDesc = buyLegs
      .map((l) => {
        const q = getQuote("buy", l.symbol);
        return q !== undefined ? `~${fmt(q)} ${l.symbol}` : `${l.symbol}`;
      })
      .join(", ");
    toast.info("Rebalancing…", {
      description: [sellDesc && `Selling ${sellDesc}`, buyDesc && `buying ${buyDesc}`].filter(Boolean).join(" — "),
    });

    await execute(sellLegs, buyLegs);
  }

  function handleReset() {
    reset();
    setSellStr({});
    setBuyStr({});
  }

  if (log.length > 0) {
    return (
      <div className="space-y-4">
        <ProgressLog entries={log} />
        {status === "success" && receipt && (
          <div className="space-y-2 rounded-lg border bg-card p-4 text-sm">
            {receipt.sold.length > 0 && (
              <p>
                Sold:{" "}
                {receipt.sold.map((s) => `${fmt(s.amountOut)} ${s.symbol}`).join(", ")}
              </p>
            )}
            {receipt.bought.length > 0 && (
              <p>
                Bought:{" "}
                {receipt.bought.map((b) => `${fmt(b.amountOut)} ${b.symbol}`).join(", ")}
              </p>
            )}
            {receipt.netHubDelta !== 0n && (
              <p className="text-muted-foreground">
                {receipt.netHubDelta > 0n
                  ? `Surplus bWETH refunded: ${fmt(receipt.netHubDelta)}`
                  : `bWETH shortfall pulled: ${fmt(-receipt.netHubDelta)}`}
              </p>
            )}
          </div>
        )}
        {!isBusy && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              handleReset();
              onRebalanceConfirmed();
            }}
          >
            Done
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">Sell</p>
        {ALL_TOKENS.map((symbol) => (
          <SellRow key={symbol} symbol={symbol} deployment={deployment} address={address} value={sellStr[symbol] ?? ""} onChange={(v) => setSellStr((s) => ({ ...s, [symbol]: v }))} />
        ))}
      </div>

      <Separator />

      <div className="space-y-2">
        <p className="text-sm font-medium">Buy (amount in bWETH to spend)</p>
        {ALL_TOKENS.map((symbol) => (
          <AmountRow key={symbol} symbol={symbol} value={buyStr[symbol] ?? ""} onChange={(v) => setBuyStr((s) => ({ ...s, [symbol]: v }))} suffix="bWETH" />
        ))}
      </div>

      {hasLegs && (
        <>
          <Separator />
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Hub currency (bWETH) raised from sells</span>
              <span className="font-mono tabular-nums">{fmt(sellHubTotal)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Hub currency spent on buys</span>
              <span className="font-mono tabular-nums">{fmt(buyHubTotal)}</span>
            </div>
            <div className="flex items-center justify-between font-medium">
              <span className="flex items-center gap-1">
                Net <ArrowRight className="size-3" />
              </span>
              <span className="font-mono tabular-nums">
                {sellHubTotal >= buyHubTotal
                  ? `+${fmt(sellHubTotal - buyHubTotal)} refunded`
                  : `-${fmt(buyHubTotal - sellHubTotal)} pulled from you`}
              </span>
            </div>
          </div>
        </>
      )}

      <Button className="w-full" size="lg" disabled={!!disabledReason} onClick={handleRebalance}>
        {disabledReason ?? "Rebalance"}
      </Button>
    </div>
  );
}

function SellRow({
  symbol,
  deployment,
  address,
  value,
  onChange,
}: {
  symbol: BasketTokenSymbol;
  deployment: ChainDeployment;
  address: `0x${string}` | undefined;
  value: string;
  onChange: (v: string) => void;
}) {
  const tokenAddress = getTokenAddress(deployment, symbol);
  const { data: balance } = useBalance({ address, token: tokenAddress, query: { enabled: !!address, refetchInterval: 4000 } });
  const formatted = balance ? Number(formatUnits(balance.value, balance.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 }) : undefined;
  return <AmountRow symbol={symbol} value={value} onChange={onChange} suffix={symbol.slice(1)} balance={formatted} />;
}
