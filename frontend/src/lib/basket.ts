import type { BasketTokenSymbol } from "@/config/contracts";

export type BasketAllocation = Record<BasketTokenSymbol, number>; // basis points, out of 10_000

export const TOTAL_BPS = 10_000;

export const PRESETS: { name: string; weights: Partial<BasketAllocation> }[] = [
  {
    name: "Equal split",
    weights: { bUSDC: 3334, bDAI: 3333, bLINK: 3333 },
  },
  {
    name: "Stablecoin-heavy",
    weights: { bUSDC: 5000, bDAI: 3000, bLINK: 2000 },
  },
];

export function sumWeights(weights: Partial<BasketAllocation>, active: BasketTokenSymbol[]): number {
  return active.reduce((sum, symbol) => sum + (weights[symbol] ?? 0), 0);
}

export function isValidAllocation(weights: Partial<BasketAllocation>, active: BasketTokenSymbol[]): boolean {
  if (active.length === 0) return false;
  return sumWeights(weights, active) === TOTAL_BPS;
}

/** Redistributes weight evenly across `active` tokens, matching the router's own
 * "last leg absorbs the rounding remainder" convention so the UI preview never implies
 * a split that doesn't actually sum to 100%. */
export function evenSplit(active: BasketTokenSymbol[]): BasketAllocation {
  const result = {} as BasketAllocation;
  if (active.length === 0) return result;
  const base = Math.floor(TOTAL_BPS / active.length);
  let allocated = 0;
  active.forEach((symbol, i) => {
    const weight = i === active.length - 1 ? TOTAL_BPS - allocated : base;
    result[symbol] = weight;
    allocated += weight;
  });
  return result;
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}
