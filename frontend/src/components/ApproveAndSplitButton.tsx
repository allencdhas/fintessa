"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

import type { SplitSwapStatus } from "@/hooks/useSplitSwap";

const BUSY_STATUSES: SplitSwapStatus[] = [
  "checking-allowance",
  "awaiting-approve-signature",
  "approving",
  "awaiting-split-signature",
  "splitting",
];

export function ApproveAndSplitButton({
  onClick,
  status,
  disabled,
  disabledReason,
}: {
  onClick: () => void;
  status: SplitSwapStatus;
  disabled: boolean;
  disabledReason?: string;
}) {
  const busy = BUSY_STATUSES.includes(status);

  return (
    <div className="space-y-1">
      <Button size="lg" className="w-full" onClick={onClick} disabled={disabled || busy}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        {busy ? "Processing…" : "Approve + Split"}
      </Button>
      {disabled && disabledReason && <p className="text-center text-xs text-muted-foreground">{disabledReason}</p>}
    </div>
  );
}
