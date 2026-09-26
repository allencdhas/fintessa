import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { mock } from "wagmi/connectors";

import { anvilLocal, baseSepolia } from "./chains";

/**
 * Anvil's well-known default account #1 (index 1, NOT the deployer at index 0). Its
 * private key is public knowledge (printed by every `anvil` boot) — this is only ever
 * used against the local Anvil chain, never a real network.
 */
export const ANVIL_DEV_WALLET_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;

/**
 * The wagmi "mock" connector forwards unhandled JSON-RPC methods (including
 * `eth_sendTransaction`) straight to the configured RPC URL. Anvil auto-signs
 * transactions from its own default "unlocked" accounts, so this gives us a real,
 * one-click, no-browser-extension wallet for local demoing/testing — while real users on
 * Base Sepolia still connect a real wallet via the `injected` connector below.
 */
const anvilDevConnector = mock({
  accounts: [ANVIL_DEV_WALLET_ADDRESS],
});

export const wagmiConfig = createConfig({
  chains: [anvilLocal, baseSepolia],
  connectors: [injected(), anvilDevConnector],
  transports: {
    [anvilLocal.id]: http(),
    [baseSepolia.id]: http(),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
