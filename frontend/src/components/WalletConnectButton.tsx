"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { anvilLocal, SUPPORTED_CHAIN_ID } from "@/config/chains";

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletConnectButton() {
  const { address, isConnected, chain } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  if (isConnected && address) {
    const wrongChain = chain?.id !== SUPPORTED_CHAIN_ID;
    return (
      <div className="flex items-center gap-2">
        {wrongChain && (
          <Button size="sm" variant="secondary" onClick={() => switchChain({ chainId: SUPPORTED_CHAIN_ID })}>
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

  // The mock/dev connector only ever works against local Anvil — hide it once the app is
  // pointed at a real network (e.g. Base Sepolia via NEXT_PUBLIC_CHAIN).
  const visibleConnectors = connectors.filter(
    (connector) => connector.id !== "mock" || SUPPORTED_CHAIN_ID === anvilLocal.id
  );

  return (
    <div className="flex items-center gap-2">
      {visibleConnectors.map((connector) => (
        <Button
          key={connector.uid}
          size="sm"
          variant={connector.id === "mock" ? "default" : "outline"}
          disabled={isPending}
          onClick={() => connect({ connector, chainId: connector.id === "mock" ? anvilLocal.id : SUPPORTED_CHAIN_ID })}
        >
          {connector.id === "mock" ? "Connect Anvil Test Wallet" : "Connect Wallet"}
        </Button>
      ))}
    </div>
  );
}
