"use client";
/**
 * Login via Privy, started from our own UnlockDialog: Google / X / email open Privy's modal for that
 * one method (OAuth in a popup, email code inside the modal) and create a Privy
 * embedded wallet; "External wallet" opens Privy's wallet list — Core and Rabby (detected extension wallets via EIP-6963), MetaMask, WalletConnect.
 * The connected wallet only signs: one message to derive the shielded keys, and the
 * permit + intent for "From my wallet" deposits. Without NEXT_PUBLIC_PRIVY_APP_ID only the demo
 * account is offered.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PrivyProvider, useLogin, usePrivy, useSignMessage, useWallets } from "@privy-io/react-auth";
import { avalanche, avalancheFuji } from "viem/chains";
import { defineChain, type Address, type Hex } from "viem";

export type Eip1193 = { request(args: { method: string; params?: unknown[] | object }): Promise<unknown> };

export interface Auth {
  enabled: boolean;
  ready: boolean;
  authenticated: boolean;
  address: Address | null;
  walletLabel: string | null;
  provider: Eip1193 | null;
  /** Privy's wallet list only (Core, Rabby, MetaMask, WalletConnect). */
  login(): void;
  /** Opens Privy's modal for Google / X (OAuth popup). */
  oauth(provider: "google" | "twitter"): Promise<void>;
  /** Email: sendCode opens Privy's modal prefilled with the address; the code is entered there. */
  emailStep: "idle" | "sending" | "code" | "verifying";
  sendCode(email: string): Promise<void>;
  submitCode(code: string): Promise<void>;
  logout(): Promise<void>;
  /** How the user logged in, for the profile ("Google", "X", "Email", "Wallet") and the account (email, @handle). */
  account: { method: string; id: string | null } | null;
  /** Privy embedded wallet: sign with Privy's own confirmation screen (our title / copy). null otherwise. */
  signEmbedded: ((message: string) => Promise<Hex>) | null;
  /** Last Privy login error (OAuth callback, wallet modal); the redirect back hides it otherwise. */
  error: string | null;
}

const disabled: Auth = { enabled: false, ready: true, authenticated: false, address: null, walletLabel: null, provider: null, login() {}, async oauth() {}, emailStep: "idle", async sendCode() {}, async submitCode() {}, async logout() {}, error: null, account: null, signEmbedded: null };
const AuthCtx = createContext<Auth>(disabled);
export const useAuth = () => useContext(AuthCtx);

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";

const localCChain = defineChain({
  id: 1337,
  name: "Avalanche Local C-Chain",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:9650/ext/bc/C/rpc"] } },
  testnet: true,
});

function Bridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, logout, user } = usePrivy();
  const { signMessage } = useSignMessage();
  const { wallets } = useWallets();
  const [error, setError] = useState<string | null>(null);
  const report = (e: unknown) => {
    const msg = typeof e === "string" ? e : (e as Error)?.message || String(e);
    if (msg === "exited_auth_flow") return; // the user closed Privy's modal
    console.error("[privy] login failed:", e);
    setError(`Login failed: ${msg}`);
  };
  // Google / X / email open Privy's own modal (OAuth runs in a popup, the
  // email code is entered there), so nothing depends on finishing an OAuth redirect in our page.
  const { login } = useLogin({ onError: report, onComplete: () => setError(null) });
  // Privy ignores login() while a session exists. A session whose wallet is gone (e.g. an earlier
  // Core / MetaMask login with the extension now locked) would leave every login button dead, so
  // end it first.
  const fresh = async (opts: Parameters<typeof login>[0]) => {
    setError(null);
    if (authenticated) await logout().catch(() => undefined);
    login(opts);
  };
  // the Privy embedded wallet first (Google / X / email); otherwise the external wallet used to log in
  const wallet = authenticated ? (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0] ?? null) : null;
  const [provider, setProvider] = useState<Eip1193 | null>(null);
  useEffect(() => {
    let live = true;
    if (!wallet) {
      setProvider(null);
      return;
    }
    wallet.getEthereumProvider().then((p) => live && setProvider(p as Eip1193));
    return () => {
      live = false;
    };
  }, [wallet]);
  const value = useMemo<Auth>(
    () => ({
      enabled: true,
      ready,
      authenticated,
      address: (wallet?.address as Address) ?? null,
      walletLabel: wallet ? (wallet.walletClientType === "privy" ? "Privy embedded wallet" : wallet.walletClientType.replace(/_/g, " ")) : null,
      provider,
      login: () => void fresh({ loginMethods: ["wallet"] }),
      oauth: (p) => fresh({ loginMethods: [p] }),
      emailStep: "idle",
      sendCode: (e) => fresh({ loginMethods: ["email"], prefill: { type: "email", value: e } }),
      async submitCode() {},
      logout: () => logout(),
      error,
      account: !user
        ? null
        : user.google
          ? { method: "Google", id: user.google.email }
          : user.twitter
            ? { method: "X", id: user.twitter.username ? `@${user.twitter.username}` : null }
            : user.email
              ? { method: "Email", id: user.email.address }
              : { method: "Wallet", id: null },
      signEmbedded:
        wallet?.walletClientType === "privy"
          ? async (message) =>
              (
                await signMessage(
                  { message },
                  {
                    address: wallet.address,
                    uiOptions: {
                      title: "Unlock your private balance",
                      description: "One free signature creates your private keys. They never leave this device.",
                      buttonText: "Sign and unlock",
                    },
                  },
                )
              ).signature as Hex
          : null,
    }),
    [ready, authenticated, wallet, provider, login, logout, error, user, signMessage], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <AuthCtx.Provider value={disabled}>{children}</AuthCtx.Provider>;
  const network = process.env.NEXT_PUBLIC_NETWORK || "local";
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "twitter", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#EF3340",
          logo: "/logo.png",
          landingHeader: "Unlock your private balance",
          walletChainType: "ethereum-only",
          walletList: ["detected_ethereum_wallets", "metamask", "wallet_connect_qr"],
        },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        defaultChain: network === "fuji" ? avalancheFuji : localCChain,
        supportedChains: [avalancheFuji, avalanche, localCChain],
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}
