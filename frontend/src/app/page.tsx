"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { parseUnits, formatUnits } from "viem";

import { WalletConnectButton } from "@/components/WalletConnectButton";
import { FaucetPanel } from "@/components/FaucetPanel";
import { AmountInput } from "@/components/AmountInput";
import { BasketAllocator, REQUIRED_TOKENS, STRETCH_TOKEN } from "@/components/BasketAllocator";
import { TokenBadge } from "@/components/TokenBadge";
import { ApproveAndSplitButton } from "@/components/ApproveAndSplitButton";
import { TxStatusCard } from "@/components/TxStatusCard";
import { ReceiptSummary } from "@/components/ReceiptSummary";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { useDeployment } from "@/hooks/useDeployment";
import { useBasketQuote } from "@/hooks/useBasketQuote";
import { useSplitSwap } from "@/hooks/useSplitSwap";
import { BASKET_TOKENS, getTokenAddress, type BasketTokenSymbol } from "@/config/contracts";
import { evenSplit, isValidAllocation, type BasketAllocation } from "@/lib/basket";

export default function Home() {
  const { isConnected } = useAccount();
  const { deployment, chainId } = useDeployment();

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
  const { execute, status, error, receipt, reset } = useSplitSwap(deployment);

  function toggleStretchToken(enabled: boolean) {
    const nextActive = enabled ? [...REQUIRED_TOKENS, STRETCH_TOKEN] : REQUIRED_TOKENS;
    setActive(nextActive);
    setWeights(evenSplit(nextActive));
  }

  const validAllocation = isValidAllocation(weights, active);
  const hasAmount = amountInWei !== undefined && amountInWei > 0n;

  async function handleSplit() {
    if (!deployment || !amountInWei) return;
    reset();
    await execute(
      amountInWei,
      active.map((symbol) => ({ symbol, weightBps: weights[symbol] ?? 0, quotedAmountOut: quotes[symbol] }))
    );
  }

  let disabledReason: string | undefined;
  if (!isConnected) disabledReason = "Connect a wallet to continue.";
  else if (!deployment) disabledReason = `No Bento Box deployment found for chain ${chainId}.`;
  else if (!hasAmount) disabledReason = "Enter an amount to split.";
  else if (!validAllocation) disabledReason = "Basket weights must sum to 100%.";
  else if (quoteLoading) disabledReason = "Fetching live quote…";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">🍱 Bento Box</h1>
          <p className="text-sm text-muted-foreground">Split one swap into a basket, atomically, on Uniswap v4.</p>
        </div>
        <WalletConnectButton />
      </header>

      {!isConnected ? (
        <Card>
          <CardHeader>
            <CardTitle>Connect a wallet to start</CardTitle>
            <CardDescription>
              Bento Box is a Uniswap v4 periphery router: one input token in, a fixed basket of output tokens out, in a
              single atomic transaction.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : !deployment ? (
        <Card>
          <CardHeader>
            <CardTitle>Unsupported network</CardTitle>
            <CardDescription>Switch to the Bento Box demo network to continue (chain id {chainId}).</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>1. Get test tokens</CardTitle>
                <CardDescription>Open faucet — mint yourself demo bWETH, no external faucet needed.</CardDescription>
              </div>
              <FaucetPanel deployment={deployment} />
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Choose your split</CardTitle>
              <CardDescription>Pick a preset or drag the sliders — weights always sum to 100%.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AmountInput value={amountInStr} onChange={setAmountInStr} wethAddress={deployment.bWETH} />
              <Separator />
              <BasketAllocator active={active} weights={weights} onChange={setWeights} onToggleStretchToken={toggleStretchToken} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Preview &amp; confirm</CardTitle>
              <CardDescription>Live on-chain quote per leg — this is exactly what the router will execute.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {active.map((symbol) => {
                  const token = BASKET_TOKENS.find((t) => t.symbol === symbol)!;
                  const quoted = quotes[symbol];
                  return (
                    <div key={symbol} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className={`size-2.5 rounded-full ${token.colorClassName}`} />
                        {symbol}
                      </span>
                      <span className="font-mono tabular-nums text-muted-foreground">
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

              <TxStatusCard status={status} error={error} />
              {status === "success" && receipt && <ReceiptSummary receipt={receipt} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your basket</CardTitle>
              <CardDescription>Live balances after your split lands.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <TokenBadge
                token={{ symbol: "bWETH", displayName: "Bento Wrapped Ether (input)", colorClassName: "bg-zinc-500" }}
                tokenAddress={deployment.bWETH}
              />
              {active.map((symbol) => (
                <TokenBadge
                  key={symbol}
                  token={BASKET_TOKENS.find((t) => t.symbol === symbol)!}
                  tokenAddress={getTokenAddress(deployment, symbol)}
                />
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
