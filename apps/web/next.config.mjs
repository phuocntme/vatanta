/** @type {import('next').NextConfig} */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ---- Content-Security-Policy (production only; `next dev` needs eval for hot reload)
// Scripts only from this origin: no third-party script can run in the page that holds the keys.
// Network access only to our own services (relayer, indexer, RPCs from the build env and the
// deployment file), Privy / WalletConnect, and the Aztec CRS hosts bb.js downloads from.
const origin = (u) => {
  try {
    return u ? new URL(u).origin : null;
  } catch {
    return null;
  }
};
const network = process.env.NEXT_PUBLIC_NETWORK ?? "local";
const depFile = join(here, "..", "..", "contracts", "deployments", `${network}.json`);
const dep = existsSync(depFile) ? JSON.parse(readFileSync(depFile, "utf8")) : {};
const own = [
  process.env.NEXT_PUBLIC_RELAYER_URL || "http://127.0.0.1:8080",
  process.env.NEXT_PUBLIC_INDEXER_URL || "http://127.0.0.1:8081",
  process.env.NEXT_PUBLIC_L1_RPC || dep.l1Rpc,
  process.env.NEXT_PUBLIC_C_RPC || dep.cRpc,
].map(origin);
// Privy also reads balances from the public RPCs of the chains it lists (Fuji is covered by cRpc).
const privy = ["https://auth.privy.io", "https://*.privy.io", "https://*.rpc.privy.systems", "https://api.avax.network", "https://api.avax-test.network"];
const walletConnect = ["https://*.walletconnect.com", "https://*.walletconnect.org", "wss://relay.walletconnect.com", "wss://relay.walletconnect.org", "wss://www.walletlink.org", "https://www.walletlink.org", "https://api.web3modal.org"];
const crs = ["https://crs.aztec-cdn.foundation", "https://crs.aztec-labs.com"];
const csp = [
  "default-src 'self'",
  // Next.js App Router hydrates with inline scripts; wasm-unsafe-eval lets bb.js compile its WASM.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // data: / blob: — bb.js loads its prover WASM with fetch("data:application/gzip;base64,…"); without
  // them every proof (send, split, withdraw) fails with "Failed to fetch".
  `connect-src 'self' data: blob: ${[...new Set([...own, ...privy, ...walletConnect, ...crs].filter(Boolean))].join(" ")}`,
  "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig = {
  transpilePackages: ["@vatanta/sdk"],
  poweredByHeader: false,
  async headers() {
    return process.env.NODE_ENV === "production" ? [{ source: "/:path*", headers: securityHeaders }] : [];
  },
  // Docker builds use a self-contained server (much smaller image); `next start` locally.
  ...(process.env.NEXT_OUTPUT === "standalone"
    ? { output: "standalone", outputFileTracingRoot: join(here, "..", "..") }
    : {}),
  // No COOP/COEP: cross-origin isolation would break Privy's embedded-wallet iframe and wallet
  // popups. bb.js then proves single-threaded (≈1–2 s for these ~9k-gate circuits).
  webpack: (config, { isServer }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true, topLevelAwait: true };
    // the SDK is TypeScript source with ESM-style ".js" import specifiers
    // Privy's optional Solana integrations are unused (walletChainType: "ethereum-only").
    config.resolve.alias = { ...config.resolve.alias, "@solana-program/system": false, "@solana-program/token": false, "@solana-program/memo": false, "@farcaster/mini-app-solana": false, "@abstract-foundation/agw-client": false, permissionless: false };
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, os: false, crypto: false, worker_threads: false, child_process: false, module: false, url: false };
    }
    config.output.environment = { ...config.output.environment, asyncFunction: true };
    return config;
  },
};
export default nextConfig;
