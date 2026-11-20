import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const ROOT = join(import.meta.dirname, "..", "..");

export interface Deployment {
  network: string;
  cChainId: number;
  l1ChainId: number;
  cRpc: string;
  l1Rpc: string;
  cBlockchainId: Hex;
  l1BlockchainId: Hex;
  usdc: Address;
  usdcIsMock: boolean;
  tokenHome: Address;
  tokenRemote: Address;
  depositRouter: Address;
  shieldedPool: Address;
  verifierRegistry: Address;
  relayerRegistry: Address;
  l1StartBlock: number;
  cStartBlock: number;
}

export function loadDeployment(network = process.env.NETWORK ?? "local"): Deployment {
  return JSON.parse(readFileSync(join(ROOT, "contracts", "deployments", `${network}.json`), "utf8"));
}

export function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function clients(d: Deployment, pk: Hex) {
  const account = privateKeyToAccount(pk);
  const cChain = defineChain({ id: d.cChainId, name: "C-Chain", nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, rpcUrls: { default: { http: [d.cRpc] } } });
  const l1 = defineChain({ id: d.l1ChainId, name: "Vatanta L1", nativeCurrency: { name: "VNT", symbol: "VNT", decimals: 18 }, rpcUrls: { default: { http: [d.l1Rpc] } } });
  return {
    account,
    c: createPublicClient({ chain: cChain, transport: http() }),
    l1: createPublicClient({ chain: l1, transport: http() }),
    cw: createWalletClient({ account, chain: cChain, transport: http() }),
    l1w: createWalletClient({ account, chain: l1, transport: http() }),
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(what: string, fn: () => Promise<T | undefined | false>, timeoutMs = 120_000, everyMs = 1_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(everyMs);
  }
}

export const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
