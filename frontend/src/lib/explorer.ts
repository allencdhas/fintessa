import { anvilLocal, baseSepolia } from "@/config/chains";

/** Returns the block-explorer URL for a tx hash on the given chain, or `undefined` if the
 * chain has no indexed explorer (i.e. local Anvil). */
export function explorerTxUrl(chainId: number, hash: string): string | undefined {
  if (chainId === baseSepolia.id) return `https://sepolia.basescan.org/tx/${hash}`;
  if (chainId === anvilLocal.id) return undefined;
  return `https://basescan.org/tx/${hash}`;
}
