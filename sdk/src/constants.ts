/** Product name used in signed messages and EIP-712 domains. Rename here (and in apps/web/lib/brand.ts). */
export const BRAND = "Vatanta";

/** BN254 scalar field. */
export const P = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

export const DOM = { OWNER: 1n, PRE: 2n, NOTE: 3n, NULL: 4n, BLIND: 5n, SPEND: 6n } as const;

export const TREE_DEPTH = 32;

/** 1 USDC in micro-USDC (6 decimals). */
export const USDC = 1_000_000n;

// ---- locked parameters (SPEC.md §2) ----
export const SEND_FEE = 100_000n; // 0.10 USDC
export const FEE_BPS = 25n; // 0.25 %
export const MIN_DEPOSIT = 20n * USDC;
export const DENOMINATIONS = [10_000n * USDC, 1_000n * USDC, 100n * USDC, 10n * USDC] as const; // largest first
export const MAX_PIECES = 12;
export const BATCH_INTERVAL_SECS = 600;
export const ROOT_WINDOW_SECS = 48 * 3600;
export const PATTERN_WINDOW_SECS = 7 * 24 * 3600;

export type TimingMode = "fast" | "standard" | "max";
export const TIMING_WINDOW_SECS: Record<TimingMode, number> = { fast: 0, standard: 6 * 3600, max: 24 * 3600 };

export const PRIVACY_GREEN = 20;
export const PRIVACY_YELLOW = 5;

/**
 * Message signed once to derive all shielded keys (SPEC.md §4.2) by signers that a phishing page
 * cannot reach: the Privy embedded wallet (origin-locked), the in-browser demo key, and scripts.
 * External browser wallets (MetaMask, Core…) sign the domain-bound `keyMessage()` instead.
 */
export const KEY_MESSAGE = `${BRAND} shielded account v1\nSign to derive your private keys. This does not cost gas.`;

export const ADDRESS_HRP = "zk";
