"use client";

import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Address } from "viem";

export function AmountInput({
  value,
  onChange,
  wethAddress,
}: {
  value: string;
  onChange: (value: string) => void;
  wethAddress: Address;
}) {
  const { address } = useAccount();
  const { data: balance } = useBalance({
    address,
    token: wethAddress,
    query: { enabled: !!address, refetchInterval: 4000 },
  });

  const formattedBalance = balance ? formatUnits(balance.value, balance.decimals) : undefined;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <label htmlFor="amount-in" className="font-medium">
          Amount to split (bWETH)
        </label>
        <span className="text-muted-foreground">
          Balance: {formattedBalance ? Number(formattedBalance).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          id="amount-in"
          inputMode="decimal"
          placeholder="0.3"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!formattedBalance}
          onClick={() => formattedBalance && onChange(formattedBalance)}
        >
          Max
        </Button>
      </div>
    </div>
  );
}
