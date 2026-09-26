"use client";

import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { SplitSwapStatus } from "@/hooks/useSplitSwap";

const STATUS_LABEL: Record<SplitSwapStatus, string> = {
  idle: "",
  "checking-allowance": "Checking your bWETH allowance…",
  "awaiting-approve-signature": "Waiting for approve signature in your wallet…",
  approving: "Approving bWETH for the router…",
  "awaiting-split-signature": "Waiting for split signature in your wallet…",
  splitting: "Sending your basket split…",
  success: "Basket split complete!",
  error: "Something went wrong.",
};

export function TxStatusCard({ status, error }: { status: SplitSwapStatus; error: Error | null }) {
  if (status === "idle") return null;

  if (status === "error") {
    return (
      <Alert variant="destructive">
        <XCircle className="size-4" />
        <AlertTitle>Transaction failed — no funds moved</AlertTitle>
        <AlertDescription className="break-words">{error?.message ?? "Unknown error"}</AlertDescription>
      </Alert>
    );
  }

  if (status === "success") {
    return (
      <Alert className="border-emerald-500/40 bg-emerald-500/10">
        <CheckCircle2 className="size-4 text-emerald-600" />
        <AlertTitle>{STATUS_LABEL[status]}</AlertTitle>
        <AlertDescription>All legs settled atomically in one transaction.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <Loader2 className="size-4 animate-spin" />
      <AlertTitle>{STATUS_LABEL[status]}</AlertTitle>
      <AlertDescription>All-or-nothing: if any leg fails, the whole transaction reverts.</AlertDescription>
    </Alert>
  );
}
