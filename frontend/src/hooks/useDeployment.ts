"use client";

import { useChainId } from "wagmi";

import { getDeployment } from "@/config/contracts";

export function useDeployment() {
  const chainId = useChainId();
  const deployment = getDeployment(chainId);
  return { chainId, deployment };
}
