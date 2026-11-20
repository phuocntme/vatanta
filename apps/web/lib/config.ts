import type { Address, Hex } from "viem";

export interface AppConfig {
  network: string;
  cChainId: number;
  l1ChainId: number;
  cRpc: string;
  l1Rpc: string;
  usdc: Address;
  usdcIsMock: boolean;
  tokenHome: Address;
  tokenRemote: Address;
  depositRouter: Address;
  shieldedPool: Address;
  verifierRegistry: Address;
  relayerRegistry: Address;
  l1StartBlock: number;
  cBlockchainId: Hex;
  l1BlockchainId: Hex;
  relayerUrl: string;
  indexerUrl: string;
  explorerC: string;
}

export async function loadConfig(): Promise<AppConfig> {
  const r = await fetch("/deployment.json", { cache: "no-store" });
  if (!r.ok) throw new Error("No deployment found. Run the local network + deploy first (see README).");
  const d = await r.json();
  return {
    ...d,
    l1Rpc: process.env.NEXT_PUBLIC_L1_RPC || d.l1Rpc,
    cRpc: process.env.NEXT_PUBLIC_C_RPC || d.cRpc,
    relayerUrl: process.env.NEXT_PUBLIC_RELAYER_URL || "http://127.0.0.1:8080",
    indexerUrl: process.env.NEXT_PUBLIC_INDEXER_URL || "http://127.0.0.1:8081",
    explorerC: d.network === "fuji" ? "https://testnet.snowtrace.io" : "",
  };
}
