"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { parseEther } from "viem";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { mockMintableErc20Abi, type ChainDeployment } from "@/config/contracts";

const FAUCET_AMOUNT_WETH = "5";

export function FaucetPanel({ deployment }: { deployment: ChainDeployment }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [isMinting, setIsMinting] = useState(false);

  async function mint() {
    if (!address || !publicClient) return;
    setIsMinting(true);
    try {
      const hash = await writeContractAsync({
        address: deployment.bWETH,
        abi: mockMintableErc20Abi,
        functionName: "mint",
        args: [address, parseEther(FAUCET_AMOUNT_WETH)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`Minted ${FAUCET_AMOUNT_WETH} bWETH`, {
        description: "Open faucet mint — testnet only, no real value.",
      });
    } catch (e) {
      toast.error("Mint failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsMinting(false);
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={mint} disabled={!address || isMinting}>
      {isMinting ? "Minting…" : `Get ${FAUCET_AMOUNT_WETH} test bWETH`}
    </Button>
  );
}
