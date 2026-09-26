"use client";

import { useEffect, useRef } from "react";
import { useChainId } from "wagmi";
import { Loader2, CheckCircle2, XCircle, Circle, ExternalLink } from "lucide-react";

import { cn } from "cn";
import { explorerTxUrl } from "@/lib/explorer";
import type { SplitLogEntry } from "@/hooks/useSplitSwap";

function LevelIcon({ level }: { level: SplitLogEntry["level"] }) {
  switch (level) {
    case "pending":
      return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />;
    case "success":
      return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />;
    case "error":
      return <XCircle className="size-3.5 shrink-0 text-destructive" />;
    default:
      return <Circle className="size-2 shrink-0 fill-muted-foreground text-muted-foreground" />;
  }
}

function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour12: false });
}

export function ProgressLog({ entries }: { entries: SplitLogEntry[] }) {
  const chainId = useChainId();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border py-8 text-center">
        <p className="text-sm text-muted-foreground">No activity yet</p>
        <p className="text-xs text-muted-foreground/70">Submit a split to see live progress here.</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="max-h-72 space-y-0 overflow-y-auto pr-1">
      {entries.map((entry, i) => {
        const isLast = i === entries.length - 1;
        const url = entry.txHash ? explorerTxUrl(chainId, entry.txHash) : undefined;
        return (
          <div key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast && <span className="absolute top-4 left-[6.5px] h-full w-px bg-border" aria-hidden />}
            <div className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
              <LevelIcon level={entry.level} />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={cn(
                    "text-sm leading-snug break-words",
                    entry.level === "error" ? "text-destructive" : "text-foreground"
                  )}
                >
                  {entry.message}
                </p>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {formatClock(entry.timestamp)}
                </span>
              </div>
              {entry.txHash && (
                url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {entry.txHash.slice(0, 10)}…{entry.txHash.slice(-6)} <ExternalLink className="size-2.5" />
                  </a>
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {entry.txHash.slice(0, 10)}…{entry.txHash.slice(-6)}
                  </span>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
