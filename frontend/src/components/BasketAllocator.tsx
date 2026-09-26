"use client";

import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "cn";

import { BASKET_TOKENS, type BasketTokenSymbol } from "@/config/contracts";
import { PRESETS, TOTAL_BPS, evenSplit, formatBps, type BasketAllocation } from "@/lib/basket";

const REQUIRED_TOKENS: BasketTokenSymbol[] = ["bUSDC", "bDAI", "bLINK"];
const STRETCH_TOKEN: BasketTokenSymbol = "bUNI";

function redistribute(weights: BasketAllocation, active: BasketTokenSymbol[], changed: BasketTokenSymbol, newValue: number): BasketAllocation {
  const clamped = Math.max(0, Math.min(TOTAL_BPS, Math.round(newValue)));
  const others = active.filter((s) => s !== changed);
  const remaining = TOTAL_BPS - clamped;
  const next: BasketAllocation = { ...weights, [changed]: clamped };

  if (others.length === 0) return next;

  const othersSum = others.reduce((sum, s) => sum + (weights[s] ?? 0), 0);
  let allocated = 0;
  others.forEach((symbol, i) => {
    if (i === others.length - 1) {
      next[symbol] = remaining - allocated;
      return;
    }
    const share = othersSum > 0 ? Math.round(((weights[symbol] ?? 0) / othersSum) * remaining) : Math.round(remaining / others.length);
    next[symbol] = share;
    allocated += share;
  });
  return next;
}

export function BasketAllocator({
  active,
  weights,
  onChange,
  onToggleStretchToken,
}: {
  active: BasketTokenSymbol[];
  weights: BasketAllocation;
  onChange: (weights: BasketAllocation) => void;
  onToggleStretchToken: (enabled: boolean) => void;
}) {
  const stretchEnabled = active.includes(STRETCH_TOKEN);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset.name}
            size="sm"
            variant="outline"
            onClick={() => onChange({ ...weights, ...preset.weights } as BasketAllocation)}
          >
            {preset.name}
          </Button>
        ))}
        <Button size="sm" variant="outline" onClick={() => onChange(evenSplit(active))}>
          Reset to equal
        </Button>
      </div>

      <div className="space-y-3">
        {active.map((symbol) => {
          const token = BASKET_TOKENS.find((t) => t.symbol === symbol)!;
          const value = weights[symbol] ?? 0;
          return (
            <div key={symbol} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <span className={cn("size-2.5 rounded-full", token.colorClassName)} />
                  {symbol}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">{formatBps(value)}</span>
              </div>
              <Slider
                value={[value]}
                min={0}
                max={TOTAL_BPS}
                step={25}
                onValueChange={([v]) => onChange(redistribute(weights, active, symbol, v))}
              />
            </div>
          );
        })}
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox
          checked={stretchEnabled}
          onCheckedChange={(checked) => onToggleStretchToken(checked === true)}
        />
        Add bUNI as a 4th leg (stretch)
      </label>
    </div>
  );
}

export { REQUIRED_TOKENS, STRETCH_TOKEN };
