import { defineChain } from "viem";
import { baseSepolia as baseSepoliaViem } from "viem/chains";

/**
 * Local Anvil chain used for the demo build in this environment (no live testnet RPC
 * access from this sandbox). Swap `NEXT_PUBLIC_CHAIN` to `baseSepolia` once you have a
 * funded deployer key and want to point at the real Base Sepolia deployment described in
 * docs/bento-box-build-plan.md.
 */
export const anvilLocal = defineChain({
  id: 31337,
  name: "Anvil (FinTessa demo)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
  testnet: true,
});

export const baseSepolia = baseSepoliaViem;

export const SUPPORTED_CHAIN_ID =
  process.env.NEXT_PUBLIC_CHAIN === "baseSepolia" ? baseSepolia.id : anvilLocal.id;
