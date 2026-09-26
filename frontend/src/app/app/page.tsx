"use client";

import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { RefreshCw, ArrowUpRight, Plus } from "lucide-react";

import { TokenBadge } from "@/components/TokenBadge";
import { BasketDialog } from "@/components/BasketDialog";
import { StatCard } from "@/components/StatCard";
import { Sparkline } from "@/components/Sparkline";
import { SplitHistoryList } from "@/components/SplitHistoryList";
import { Sidebar } from "@/components/Sidebar";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { useDeployment } from "@/hooks/useDeployment";
import { useSplitHistory } from "@/hooks/useSplitHistory";
import { BASKET_TOKENS, getTokenAddress, type BasketTokenSymbol } from "@/config/contracts";
import { timeAgo } from "@/lib/time";

const ALL_TOKENS: BasketTokenSymbol[] = ["bUSDC", "bDAI", "bLINK", "bUNI"];

export default function AppPage() {
  const { isConnected } = useAccount();
  const { deployment, chainId } = useDeployment();
  const { items: history, isLoading: historyLoading, refetch: refetchHistory } = useSplitHistory(deployment);

  if (!isConnected) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Connect a wallet to start</CardTitle>
            <CardDescription>
              FinTessa is a Uniswap v4 periphery router: one input token in, a fixed basket of output tokens out, in a
              single atomic transaction.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WalletConnectButton />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!deployment) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Unsupported network</CardTitle>
            <CardDescription>Switch to the FinTessa demo network to continue (chain id {chainId}).</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const totalSplits = history.length;
  const totalVolume = history.reduce((sum, item) => sum + item.amountIn, 0n);
  const lastSplitAt = history[0]?.timestamp;
  const volumeSeries = [...history]
    .reverse()
    .map((item) => Number(formatUnits(item.amountIn, 18)));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <Sidebar splitCount={totalSplits} />

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Your FinTessa activity on this network.</p>
          </div>
          <div className="flex items-center gap-2">
            <WalletConnectButton />
            <BasketDialog
              deployment={deployment}
              defaultTab="rebalance"
              onSplitConfirmed={() => refetchHistory()}
              onRebalanceConfirmed={() => refetchHistory()}
              trigger={
                <Button variant="outline" className="rounded-full">
                  <RefreshCw className="size-4" /> Rebalance
                </Button>
              }
            />
            <BasketDialog
              deployment={deployment}
              defaultTab="split"
              onSplitConfirmed={() => refetchHistory()}
              onRebalanceConfirmed={() => refetchHistory()}
              trigger={
                <Button className="rounded-full">
                  <Plus className="size-4" /> New Split
                </Button>
              }
            />
          </div>
        </div>

        <div id="overview" className="scroll-mt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="relative rounded-xl bg-primary px-4 py-3 text-primary-foreground">
              <span className="absolute top-3 right-3 flex size-6 items-center justify-center rounded-full bg-primary-foreground/15">
                <ArrowUpRight className="size-3.5" />
              </span>
              <p className="text-xs text-primary-foreground/70">Total splits</p>
              <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{totalSplits}</p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <p className="text-xs text-muted-foreground">Total bWETH split</p>
                <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums">
                  {Number(formatUnits(totalVolume, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </p>
              </div>
              <Sparkline values={volumeSeries} className="h-8 w-16 text-primary" />
            </div>
            <StatCard label="Last split" value={lastSplitAt ? timeAgo(lastSplitAt) : "—"} />
          </div>
        </div>

        <Card id="balances" className="scroll-mt-6">
          <CardHeader>
            <CardTitle>Balances</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            <TokenBadge
              token={{ symbol: "bWETH", displayName: "Bento Wrapped Ether (input)", colorClassName: "bg-zinc-500" }}
              tokenAddress={deployment.bWETH}
            />
            {ALL_TOKENS.map((symbol) => (
              <TokenBadge
                key={symbol}
                token={BASKET_TOKENS.find((t) => t.symbol === symbol)!}
                tokenAddress={getTokenAddress(deployment, symbol)}
              />
            ))}
          </CardContent>
        </Card>

        <Card id="activity" className="scroll-mt-6">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Recent splits</CardTitle>
              <CardDescription>Read directly from the router&apos;s on-chain history for this account.</CardDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => refetchHistory()} disabled={historyLoading} title="Refresh">
              <RefreshCw className={historyLoading ? "animate-spin" : undefined} />
            </Button>
          </CardHeader>
          <CardContent>
            <SplitHistoryList items={history} isLoading={historyLoading} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
