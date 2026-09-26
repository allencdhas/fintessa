"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { anvilLocal } from "@/config/chains";

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletConnectButton() {
  const { address, isConnected, chain } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (isConnected && address) {
    const wrongChain = chain?.id !== anvilLocal.id;
    return (
      <div className="flex items-center gap-2">
        {wrongChain && (
          <Button size="sm" variant="secondary" onClick={() => switchChain({ chainId: anvilLocal.id })}>
            Switch network
          </Button>
        )}
        <Badge variant="outline" className="font-mono text-xs">
          {chain?.name ?? "Unknown chain"}
        </Badge>
        <Button variant="outline" size="sm" onClick={() => disconnect()}>
          {shortenAddress(address)}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {connectors.map((connector) => (
        <Button
          key={connector.uid}
          size="sm"
          variant={connector.id === "mock" ? "default" : "outline"}
          disabled={isPending}
          onClick={() => connect({ connector, chainId: anvilLocal.id })}
        >
          {connector.id === "mock" ? "Connect Anvil Test Wallet" : "Connect Wallet"}
        </Button>
      ))}
    </div>
  );
}
