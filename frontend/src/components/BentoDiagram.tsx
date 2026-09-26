import { BASKET_TOKENS } from "@/config/contracts";

const OUTPUT_SYMBOLS: Array<(typeof BASKET_TOKENS)[number]["symbol"]> = ["bUSDC", "bDAI", "bLINK"];

export function BentoDiagram() {
  const outputs = OUTPUT_SYMBOLS.map((symbol) => BASKET_TOKENS.find((t) => t.symbol === symbol)!);

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="grid grid-cols-[1.1fr_auto_1fr] items-center gap-3 sm:gap-4">
        <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-3xl bg-zinc-500/10 p-6 ring-1 ring-zinc-500/20">
          <span className="size-3.5 rounded-full bg-zinc-500" />
          <span className="text-sm font-semibold tracking-tight">bWETH</span>
          <span className="text-xs text-muted-foreground">1 input</span>
        </div>

        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <span className="text-lg leading-none">→</span>
          <span className="text-[10px] uppercase tracking-wide">atomic</span>
        </div>

        <div className="grid grid-rows-3 gap-2 sm:gap-3">
          {outputs.map((token) => (
            <div
              key={token.symbol}
              className="flex items-center gap-2 rounded-xl bg-card px-3 py-2.5 text-sm font-medium ring-1 ring-border"
            >
              <span className={`size-2.5 shrink-0 rounded-full ${token.colorClassName}`} />
              {token.symbol}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        One transaction. One approval. Every leg settles together, or none do.
      </p>
    </div>
  );
}
