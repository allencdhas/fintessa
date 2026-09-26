import type { Address } from "viem";

import deployments from "./generated/deployments.json";
import { bentoBoxRouterAbi, mockMintableErc20Abi, v4QuoterAbi } from "./generated/abis";

export { bentoBoxRouterAbi, mockMintableErc20Abi, v4QuoterAbi };

export type PoolKeyJson = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type ChainDeployment = {
  chainId: number;
  poolManager: Address;
  router: Address;
  lpRouter: Address;
  quoter: Address;
  bWETH: Address;
  bUSDC: Address;
  bDAI: Address;
  bLINK: Address;
  bUNI: Address;
  poolUsdc: PoolKeyJson;
  poolDai: PoolKeyJson;
  poolLink: PoolKeyJson;
  poolUni: PoolKeyJson;
};

const typedDeployments = deployments as unknown as Record<string, ChainDeployment>;

export function getDeployment(chainId: number): ChainDeployment | undefined {
  return typedDeployments[String(chainId)];
}

export type BasketTokenSymbol = "bUSDC" | "bDAI" | "bLINK" | "bUNI";

export type BasketTokenMeta = {
  symbol: BasketTokenSymbol;
  displayName: string;
  /** Assumed USD price used only for the demo's live quote preview (see deploy script). */
  priceUsd: number;
  colorClassName: string;
};

export const BASKET_TOKENS: BasketTokenMeta[] = [
  { symbol: "bUSDC", displayName: "Bento USD", priceUsd: 1, colorClassName: "bg-emerald-500" },
  { symbol: "bDAI", displayName: "Bento DAI", priceUsd: 1, colorClassName: "bg-amber-500" },
  { symbol: "bLINK", displayName: "Bento LINK", priceUsd: 15, colorClassName: "bg-sky-500" },
  { symbol: "bUNI", displayName: "Bento UNI", priceUsd: 8, colorClassName: "bg-fuchsia-500" },
];

export const WETH_PRICE_USD = 2000;

export function getPoolKeyForToken(deployment: ChainDeployment, symbol: BasketTokenSymbol): PoolKeyJson {
  switch (symbol) {
    case "bUSDC":
      return deployment.poolUsdc;
    case "bDAI":
      return deployment.poolDai;
    case "bLINK":
      return deployment.poolLink;
    case "bUNI":
      return deployment.poolUni;
  }
}

export function getTokenAddress(deployment: ChainDeployment, symbol: BasketTokenSymbol): Address {
  return deployment[symbol];
}
