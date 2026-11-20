"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Comlink from "comlink";
import { createPublicClient, createWalletClient, custom, defineChain, getAddress, http, type Address, type Hex, type PublicClient } from "viem";
import { useAuth } from "./auth";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ChainSource,
  IndexedDbKV,
  IndexerSource,
  KEY_MESSAGE,
  keyMessage,
  RelayerClient,
  Wallet,
  deriveKeysFromSeed,
  type Context,
  type ProverLike,
  type RelayerInfo,
  type ShieldedKeys,
  type TypedSigner,
  formatCountdown,
} from "@vatanta/sdk";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { loadConfig, type AppConfig } from "./config";
import type { ProverWorker } from "../workers/prover.worker";

/** Host the shielded keys of external wallets are bound to (SPEC.md §4.2). Empty = the current host. */
const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || "";


export interface Session {
  config: AppConfig | null;
  error: string | null;
  eoa: Address | null;
  eoaKind: "wallet" | "demo" | null;
  keys: ShieldedKeys | null;
  wallet: Wallet | null;
  info: RelayerInfo | null;
  relayer: RelayerClient | null;
  prover: ProverLike;
  ctx: Context | null;
  c: PublicClient | null;
  l1: PublicClient | null;
  /** bumps whenever wallet state changes, so views re-render */
  version: number;
  syncing: boolean;
  lastSync: number;
  /** true while a session saved in this tab is being restored */
  restoring: boolean;
  /** the unlock dialog (shown over the real screen while no wallet is unlocked) */
  unlockOpen: boolean;
  requestUnlock(): void;
  closeUnlock(): void;
  /** sign the key-derivation message with the wallet connected through Privy */
  connectWallet(): Promise<void>;
  connectDemo(): Promise<void>;
  disconnect(): void;
  sync(): Promise<void>;
  bump(): void;
  /** signer for deposits from the connected wallet */
  eoaSigner(): TypedSigner | null;
}

const Ctx = createContext<Session | null>(null);

const SEED_KEY = "vatanta:seed"; // sessionStorage: cleared when the tab closes
const DEMO_KEY = "vatanta:demo-pk"; // localStorage: demo burner for testing without a wallet
const EOA_KEY = "vatanta:eoa";

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

function safeGet(store: "local" | "session", k: string): string | null {
  try {
    return (store === "local" ? localStorage : sessionStorage).getItem(k);
  } catch {
    return null;
  }
}
function safeSet(store: "local" | "session", k: string, v: string | null) {
  try {
    const s = store === "local" ? localStorage : sessionStorage;
    if (v === null) s.removeItem(k);
    else s.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<RelayerInfo | null>(null);
  const [eoa, setEoa] = useState<Address | null>(null);
  const [eoaKind, setEoaKind] = useState<"wallet" | "demo" | null>(null);
  const auth = useAuth();
  const [keys, setKeys] = useState<ShieldedKeys | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(0);
  const [restoring, setRestoring] = useState(true);
  const workerRef = useRef<Comlink.Remote<ProverWorker> | null>(null);
  const syncLock = useRef(false);

  // ---- config + clients
  useEffect(() => {
    loadConfig().then(setConfig).catch((e) => setError(String(e.message ?? e)));
  }, []);
  const clients = useMemo(() => {
    if (!config) return { c: null, l1: null, relayer: null };
    const cChain = defineChain({ id: config.cChainId, name: "C-Chain", nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, rpcUrls: { default: { http: [config.cRpc] } } });
    const l1Chain = defineChain({ id: config.l1ChainId, name: "Vatanta L1", nativeCurrency: { name: "VNT", symbol: "VNT", decimals: 18 }, rpcUrls: { default: { http: [config.l1Rpc] } } });
    return {
      c: createPublicClient({ chain: cChain, transport: http() }) as PublicClient,
      l1: createPublicClient({ chain: l1Chain, transport: http() }) as PublicClient,
      relayer: new RelayerClient(config.relayerUrl),
    };
  }, [config]);
  useEffect(() => {
    if (!clients.relayer) return;
    const load = () => clients.relayer!.info().then(setInfo).catch(() => setInfo(null));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [clients.relayer]);

  // ---- prover worker (created on unlock and warmed up in the background)
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = Comlink.wrap<ProverWorker>(new Worker(new URL("../workers/prover.worker.ts", import.meta.url), { type: "module" }));
    }
    return workerRef.current;
  }, []);
  const prover: ProverLike = useMemo(
    () => ({
      prove: (name, inputs) => getWorker().prove(name, inputs),
      verify: (name, proof, publicInputs) => getWorker().verify(name, proof, publicInputs),
    }),
    [getWorker],
  );

  // ---- keys → wallet
  const openWallet = useCallback(
    async (seed: Uint8Array, address: Address, kind: "wallet" | "demo") => {
      if (!config || !clients.l1) return;
      const k = deriveKeysFromSeed(seed);
      const chain = new ChainSource(clients.l1, config.shieldedPool, config.l1StartBlock);
      const w = await Wallet.open({
        keys: k,
        source: new IndexerSource(config.indexerUrl, chain),
        kv: new IndexedDbKV(),
        namespace: `vatanta:${config.network}:${config.shieldedPool}:${k.address.slice(0, 24)}`,
      });
      safeSet("session", SEED_KEY, toHex(seed));
      safeSet("session", EOA_KEY, `${kind}:${address}`);
      setKeys(k);
      setEoa(address);
      setEoaKind(kind);
      setWallet(w);
    },
    [config, clients.l1],
  );

  // restore a session in this tab
  useEffect(() => {
    const seed = safeGet("session", SEED_KEY);
    const who = safeGet("session", EOA_KEY);
    if (!seed || !who) {
      setRestoring(false);
      return;
    }
    if (!config || !clients.l1 || wallet) return;
    const [kind, addr] = who.split(":");
    openWallet(fromHex(seed), addr as Address, kind as "wallet" | "demo")
      .catch((e) => setError(String(e)))
      .finally(() => setRestoring(false));
  }, [config, clients.l1, wallet, openWallet]);

  const connectWallet = useCallback(async () => {
    if (!auth.provider || !auth.address) throw new Error("Log in first.");
    const addr = auth.address;
    // The embedded wallet only works on origins allowed in Privy, so it keeps the plain message.
    // External wallets sign a domain-bound Sign-In with Ethereum message: a look-alike site asking
    // for it triggers the wallet's domain-mismatch warning (SPEC.md §4.2).
    if (!auth.signEmbedded && !config) throw new Error("Still loading the network config. Try again in a moment.");
    const sig = auth.signEmbedded
      ? await auth.signEmbedded(KEY_MESSAGE)
      : await createWalletClient({ account: addr, transport: custom(auth.provider) }).signMessage({
          account: addr,
          message: keyMessage({ address: getAddress(addr), domain: APP_DOMAIN || window.location.host, chainId: config!.cChainId }),
        });
    await openWallet(keccak_256(Uint8Array.from(sig.slice(2).match(/../g)!.map((x) => parseInt(x, 16)))), addr, "wallet");
  }, [auth.provider, auth.address, auth.signEmbedded, openWallet, config]);

  const connectDemo = useCallback(async () => {
    let pk = safeGet("local", DEMO_KEY) as Hex | null;
    if (!pk) {
      pk = generatePrivateKey();
      safeSet("local", DEMO_KEY, pk);
    }
    const acct = privateKeyToAccount(pk);
    const sig = await acct.signMessage({ message: KEY_MESSAGE });
    await openWallet(keccak_256(Uint8Array.from(sig.slice(2).match(/../g)!.map((x) => parseInt(x, 16)))), acct.address, "demo");
  }, [openWallet]);

  const disconnect = useCallback(() => {
    if (eoaKind === "wallet") auth.logout().catch(() => {});
    safeSet("session", SEED_KEY, null);
    safeSet("session", EOA_KEY, null);
    setKeys(null);
    setWallet(null);
    setEoa(null);
    setEoaKind(null);
  }, [eoaKind, auth]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const sync = useCallback(async () => {
    if (!wallet || syncLock.current) return;
    syncLock.current = true;
    setSyncing(true);
    try {
      await wallet.sync();
      setLastSync(Date.now());
      setError(null);
    } catch (e) {
      setError(`Sync failed: ${(e as Error).message}`);
    } finally {
      syncLock.current = false;
      setSyncing(false);
      bump();
    }
  }, [wallet, bump]);

  useEffect(() => {
    if (wallet) getWorker().warmup().catch(() => {});
  }, [wallet, getWorker]);

  useEffect(() => {
    if (!wallet) return;
    sync();
    const t = setInterval(sync, 4_000);
    return () => clearInterval(t);
  }, [wallet, sync]);

  const eoaSigner = useCallback((): TypedSigner | null => {
    if (!eoa) return null;
    if (eoaKind === "demo") {
      const pk = safeGet("local", DEMO_KEY) as Hex | null;
      return pk ? privateKeyToAccount(pk) : null;
    }
    if (!auth.provider || auth.address?.toLowerCase() !== eoa.toLowerCase()) return null;
    const wc = createWalletClient({ account: eoa, transport: custom(auth.provider) });
    return { address: eoa, signTypedData: (a: Parameters<typeof wc.signTypedData>[0]) => wc.signTypedData({ ...a, account: eoa }) };
  }, [eoa, eoaKind, auth.provider, auth.address]);

  const ctx: Context | null = info ? { relayer: info.relayer, chainId: info.chainId, pool: info.pool } : null;

  const [unlockOpen, setUnlockOpen] = useState(false);
  useEffect(() => {
    if (wallet) setUnlockOpen(false);
  }, [wallet]);

  const value: Session = {
    config,
    error,
    eoa,
    eoaKind,
    keys,
    wallet,
    info,
    relayer: clients.relayer,
    prover,
    ctx,
    c: clients.c,
    l1: clients.l1,
    version,
    syncing,
    lastSync,
    restoring,
    unlockOpen,
    requestUnlock: () => setUnlockOpen(true),
    closeUnlock: () => setUnlockOpen(false),
    connectWallet,
    connectDemo,
    disconnect,
    sync,
    bump,
    eoaSigner,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

/** Seconds until the next batch, ticking every second (null until mounted, to keep SSR stable). */
export function useNextBatch(): number | null {
  const { info } = useSession();
  const interval = info?.batchIntervalSecs ?? 600;
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now === null ? null : (Math.floor(now / interval) + 1) * interval - now;
}

export const countdown = (s: number | null) => (s === null ? "--:--" : formatCountdown(s));
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const everyText = (interval: number) =>
  interval % 60 === 0 ? (interval === 60 ? "Every minute" : `Every ${interval / 60} minutes`) : `Every ${interval} s (test)`;
