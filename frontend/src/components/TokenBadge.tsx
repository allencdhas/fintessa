"use client";

import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";

import { cn } from "cn";

type TokenBadgeMeta = {
  symbol: string;
  displayName: string;
  colorClassName: string;
};

export function TokenBadge({ token, tokenAddress }: { token: TokenBadgeMeta; tokenAddress: `0x${string}` }) {
  const { address } = useAccount();
  const { data: balance } = useBalance({
    address,
    token: tokenAddress,
    query: { enabled: !!address, refetchInterval: 4000 },
  });

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className={cn("size-2.5 rounded-full", token.colorClassName)} />
        <span className="font-medium">{token.symbol}</span>
        <span className="text-muted-foreground">{token.displayName}</span>
      </div>
      <span className="font-mono tabular-nums text-muted-foreground">
        {balance ? Number(formatUnits(balance.value, balance.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}
      </span>
    </div>
  );
}
