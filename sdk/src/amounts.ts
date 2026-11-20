import { DENOMINATIONS, FEE_BPS, MAX_PIECES, MIN_DEPOSIT, SEND_FEE, USDC } from "./constants.js";

/** Parse a user string like "2,350.5" into micro-USDC (truncates beyond 6 decimals). */
export function parseUsdc(s: string): bigint {
  const t = s.replace(/,/g, "").trim();
  if (!/^\d*(\.\d*)?$/.test(t) || t === "" || t === ".") return 0n;
  const [i, f = ""] = t.split(".");
  return BigInt(i || "0") * USDC + BigInt((f + "000000").slice(0, 6));
}

export function formatUsdc(x: bigint, opts: { decimals?: number; sign?: boolean } = {}): string {
  const decimals = opts.decimals ?? 2;
  const neg = x < 0n;
  const a = neg ? -x : x;
  const whole = a / USDC;
  const frac = a % USDC;
  let fracStr = frac.toString().padStart(6, "0");
  // keep significant digits beyond `decimals` (e.g. 5.875), never fewer than `decimals`
  fracStr = fracStr.replace(/0+$/, "");
  if (fracStr.length < decimals) fracStr = fracStr.padEnd(decimals, "0");
  const w = whole.toLocaleString("en-US");
  const s = fracStr.length ? `${w}.${fracStr}` : w;
  return `${neg ? "−" : opts.sign && x > 0n ? "+" : ""}${s}`;
}

export const feeOf = (gross: bigint) => (gross * FEE_BPS) / 10_000n;
export const netOf = (denomination: bigint) => denomination - feeOf(denomination);

/** Round down to a multiple of 10 USDC (split rule). */
export const roundDown10 = (x: bigint) => x - (x % (10n * USDC));

export interface Piece {
  denomination: bigint;
}

/** Greedy split, largest denomination first (SPEC.md §2). */
export function greedySplit(amount: bigint): bigint[] {
  let left = roundDown10(amount);
  const out: bigint[] = [];
  for (const d of DENOMINATIONS) {
    while (left >= d) {
      out.push(d);
      left -= d;
    }
  }
  return out;
}

export function groupPieces(pieces: bigint[]): { denomination: bigint; count: number }[] {
  const m = new Map<bigint, number>();
  for (const p of pieces) m.set(p, (m.get(p) ?? 0) + 1);
  return DENOMINATIONS.filter((d) => m.has(d)).map((d) => ({ denomination: d, count: m.get(d)! }));
}

export interface DepositQuote {
  gross: bigint;
  remainder: bigint;
  pieces: bigint[];
  fee: bigint;
  net: bigint;
  ok: boolean;
  error?: string;
}

export function quoteDeposit(amount: bigint): DepositQuote {
  const gross = roundDown10(amount);
  const pieces = greedySplit(gross);
  const net = pieces.reduce((a, d) => a + netOf(d), 0n);
  const fee = gross - net;
  const ok = gross >= MIN_DEPOSIT;
  return { gross, remainder: amount - gross, pieces, fee, net, ok, error: ok ? undefined : "Minimum deposit is 20 USDC." };
}

export interface WithdrawQuote {
  gross: bigint;
  pieces: bigint[];
  fee: bigint; // 0.25 % total
  net: bigint; // received on C-Chain
  splitFee: bigint; // one send fee for the split
  ok: boolean;
  error?: string;
}

export function quoteWithdraw(amount: bigint, privateBalance?: bigint): WithdrawQuote {
  const gross = roundDown10(amount);
  const pieces = greedySplit(gross);
  const fee = pieces.reduce((a, d) => a + feeOf(d), 0n);
  const q: WithdrawQuote = { gross, pieces, fee, net: gross - fee, splitFee: SEND_FEE, ok: true };
  if (gross === 0n) return { ...q, ok: false, error: "Enter at least 10 USDC." };
  if (pieces.length > MAX_PIECES)
    return { ...q, ok: false, error: `That needs ${pieces.length} pieces; the limit is ${MAX_PIECES}. Lower the amount or withdraw twice.` };
  if (privateBalance !== undefined && gross + SEND_FEE > privateBalance)
    return { ...q, ok: false, error: "Not enough private balance (the split costs 0.10 USDC)." };
  return q;
}

/** Pattern warning: withdrawal total equals a recent deposit total. */
export function matchesRecentDeposit(withdrawGross: bigint, recentDepositGross: bigint[]): boolean {
  return withdrawGross > 0n && recentDepositGross.some((d) => d === withdrawGross);
}
