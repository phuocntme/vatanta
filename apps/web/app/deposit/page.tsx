"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { parseAbi, type Address } from "viem";
import { formatUsdc, groupPieces, parseUsdc, quoteDeposit, signDeposit, USDC, erc20Abi, type PlannedPiece, type TokenDomain } from "@vatanta/sdk";
import { Shell } from "@/components/Shell";
import { ActionBar } from "@/components/ActionBar";
import { QR } from "@/components/QR";
import { useSession } from "@/lib/session";
import { MONO, S, shortHex } from "@/lib/ui";
import { Corners, PageHero } from "@/components/Art";

interface Active {
  address: Address;
  /** one-time address index (needed to re-sign) */
  addressIndex: number;
  gross: bigint;
  plan: PlannedPiece[];
  pieces: number;
  status: string;
  tx?: string;
  balance?: bigint;
  error?: string;
}

/** Relayer statuses after which nothing changes without a new signature. */
const STOPPED = new Set(["done", "failed", "expired"]);
const CIRCLE_FAUCET = "https://faucet.circle.com";

async function tokenDomain(c: NonNullable<ReturnType<typeof useSession>["c"]>, token: Address, chainId: number): Promise<TokenDomain> {
  try {
    const d = await c.readContract({ address: token, abi: erc20Abi, functionName: "eip712Domain" });
    return { name: d[1], version: d[2], chainId, verifyingContract: token };
  } catch {
    const [name, version] = await Promise.all([
      c.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
      c.readContract({ address: token, abi: erc20Abi, functionName: "version" }),
    ]);
    return { name, version, chainId, verifyingContract: token };
  }
}

export default function DepositPage() {
  const s = useSession();
  const { wallet, config, relayer, info, c } = s;
  const [amount, setAmount] = useState("2,350");
  const [active, setActive] = useState<Active | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const q = useMemo(() => quoteDeposit(parseUsdc(amount)), [amount]);
  const amt = parseUsdc(amount);
  // Deposits are whole denomination pieces (multiples of 10). An odd amount is refused rather than silently cut.
  const odd = q.remainder > 0n;
  const canDeposit = q.ok && !odd;
  // never reuse a one-time address: a wallet restored on a new device starts its counter at 0
  const [freeAddr, setFreeAddr] = useState<string | null>(null);
  useEffect(() => {
    if (!wallet || !relayer) return;
    let off = false;
    setFreeAddr(null);
    wallet
      .skipUsedDepositAddresses(async (a) => (await relayer.depositStatus(a).catch(() => null)) !== null)
      .then((a) => !off && setFreeAddr(a))
      .catch(() => !off && setFreeAddr(wallet.peekDepositAddress()));
    return () => {
      off = true;
    };
  }, [wallet, relayer]);
  const nextAddr = freeAddr ?? undefined;
  const shownAddr = active?.address ?? nextAddr ?? "";
  const pieces = groupPieces(q.pieces);

  // a different account was opened (log out → log in): drop the previous account's deposit
  useEffect(() => {
    setActive(null);
    setDismissed([]);
    setErr(null);
    setBusy(false);
  }, [wallet]);

  // after a reload: pick up the newest deposit that is still waiting, failed or expired
  useEffect(() => {
    if (!wallet || !relayer || active) return;
    let cancelled = false;
    (async () => {
      for (const d of wallet.pendingDeposits().slice(0, 3)) {
        const st = await relayer.depositStatus(d.address).catch(() => null);
        if (cancelled) return;
        // addressIndex < 0: an old deposit straight from the login wallet (no longer offered); the relayer still finishes it
        if (d.addressIndex < 0 || dismissed.includes(d.address) || !st?.status || st.status === "done") continue;
        setActive({
          address: d.address,
          addressIndex: d.addressIndex,
          gross: d.gross,
          plan: d.pieces,
          pieces: d.pieces.length,
          status: st.status,
          tx: st.tx ?? undefined,
          error: st.error ?? undefined,
          balance: st.balance ? BigInt(st.balance) : undefined,
        });
        setAmount((d.gross / USDC).toLocaleString("en-US"));
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, relayer, active, dismissed]);

  // poll the relayer while a deposit is in flight
  const activeAddr = active?.address;
  const stopped = !active || STOPPED.has(active.status);
  useEffect(() => {
    if (!activeAddr || !relayer || stopped) return;
    const t = setInterval(async () => {
      try {
        const st = await relayer.depositStatus(activeAddr);
        if (!st) return;
        setActive((a) =>
          a && a.address === activeAddr
            ? { ...a, status: st.status, tx: st.tx ?? a.tx, error: st.error ?? undefined, balance: st.balance ? BigInt(st.balance) : a.balance }
            : a,
        );
      } catch {
        /* keep polling */
      }
    }, 2_000);
    return () => clearInterval(t);
  }, [activeAddr, stopped, relayer]);

  /** Signs permit + intent for `pieces` from `signer` and hands them to the relayer. */
  const register = async (signer: NonNullable<ReturnType<typeof s.eoaSigner>>, owner: Address, gross: bigint, plan: PlannedPiece[]) => {
    if (!config || !relayer || !info || !c) throw new Error("Not connected to the relayer yet");
    const signed = await signDeposit({
      account: signer,
      router: config.depositRouter,
      chainId: config.cChainId,
      token: await tokenDomain(c, config.usdc, config.cChainId),
      permitNonce: await c.readContract({ address: config.usdc, abi: parseAbi(["function nonces(address) view returns (uint256)"]), functionName: "nonces", args: [owner] }),
      gross,
      pieces: plan,
      feeRecipient: info.relayer,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600),
    });
    await relayer.registerDeposit(signed);
  };

  /** Re-signs a failed or expired deposit for the same address and notes (funds already sent stay usable). */
  const retry = async () => {
    if (!wallet || !active) return;
    setBusy(true);
    setErr(null);
    try {
      const signer = wallet.depositSigner(active.addressIndex);
      if (!signer) throw new Error("Wallet not available for signing");
      await register(signer, active.address, active.gross, active.plan);
      setActive({ ...active, status: "waiting", error: undefined });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!wallet) return s.requestUnlock();
    if (!config || !relayer || !info || !c || !canDeposit) return;
    setBusy(true);
    setErr(null);
    try {
      if (relayer) await wallet.skipUsedDepositAddresses(async (a) => (await relayer.depositStatus(a).catch(() => null)) !== null);
      const plan = await wallet.planDeposit(q.gross);
      if (!plan.account) throw new Error("Wallet not available for signing");
      await register(plan.account, plan.owner, q.gross, plan.pieces);
      setActive({ address: plan.owner, addressIndex: plan.addressIndex, gross: q.gross, plan: plan.pieces, pieces: plan.pieces.length, status: "waiting" });
      s.bump();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const faucet = async () => {
    if (!config || !active) return;
    setErr(null);
    const r = await fetch(`${config.relayerUrl}/v1/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: active.address, amount: active.gross.toString() }) });
    if (!r.ok) setErr(`Faucet: ${(await r.json().catch(() => ({})))?.error?.message ?? r.status}`);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(shownAddr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const statusText = !active
    ? null
    : active.status === "waiting"
      ? `Waiting for ${formatUsdc(active.gross)} USDC at ${shortHex(active.address)}${active.balance ? ` · ${formatUsdc(active.balance)} arrived` : ""}`
      : active.status === "done"
        ? `Relayer moved it into the pool. Your ${active.pieces} pieces appear in your private balance as they cross the bridge.`
        : active.status === "expired"
          ? "This deposit's signature expired before the USDC arrived. Sign again to keep using the same address."
          : `The relayer could not move this deposit into the pool${active.error ? `: ${active.error}` : "."} USDC already sent stays at the address; sign again to retry.`;

  return (
    <Shell active="deposit">
      <main style={S.main}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Link href="/" style={S.back}>← Wallet</Link>
          <div style={{ margin: "4px 0 12px" }}>
            <ActionBar active="deposit" compact />
          </div>
          <PageHero title="Deposit" kind="deposit" />
        </div>
        <div style={S.grid2(460)}>
          <section aria-labelledby="src-h" className="vt-card" style={S.card}>
            <h2 id="src-h" style={S.h2}>Send USDC to your deposit address</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
                {shownAddr && (
                  <span style={{ position: "relative", padding: 8, borderRadius: 16, background: "rgba(8,8,10,0.6)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <Corners color="rgba(239,51,64,0.8)" size={12} inset={-1} />
                    <QR value={shownAddr} size={132} label="QR code of the one-time deposit address" />
                  </span>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: "1 1 220px", minWidth: 0 }}>
                  <span style={S.hint}>One-time deposit address · {config?.network === "fuji" ? "Fuji" : "Local"} C-Chain</span>
                  <code style={{ fontFamily: MONO, fontSize: 14, wordBreak: "break-all", padding: "12px 14px", background: "#08080A", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}>{shownAddr}</code>
                  <button type="button" onClick={copy} className="vt-ghost" style={{ ...S.ghost, alignSelf: "flex-start" }}>{copied ? "Copied" : "Copy address"}</button>
                </div>
              </div>
              <p style={{ ...S.hint, margin: 0 }}>No AVAX needed. The relayer moves it into the pool.</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label htmlFor="dep-amt" style={S.label}>Amount (USDC)</label>
              <input id="dep-amt" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!!active && active.status !== "done"} style={S.input} />
              {amt < 20n * USDC ? (
                <p role="alert" style={S.error}>Minimum deposit is 20 USDC.</p>
              ) : odd ? (
                <p role="alert" style={{ ...S.error, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px" }}>
                  Deposits go in steps of 10 USDC.
                  <button type="button" onClick={() => setAmount((q.gross / USDC).toLocaleString("en-US"))} style={{ padding: 0, border: 0, background: "none", color: "#FAFAFA", fontSize: "inherit", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>
                    Use {(q.gross / USDC).toLocaleString("en-US")} USDC
                  </button>
                </p>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="sum-h" className="vt-card" style={S.card}>
            <h2 id="sum-h" style={S.h2}>How it lands on C-Chain</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {pieces.map((p) => (
                <span key={p.denomination.toString()} style={{ display: "inline-flex", alignItems: "baseline", gap: 6, padding: "8px 14px", borderRadius: 10, background: "linear-gradient(180deg, #1F1F24, #16161A)", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), inset 3px 0 0 #EF3340", fontFamily: MONO, fontSize: 14, color: "#A1A1AA" }}>
                  {p.count} × <strong style={{ fontWeight: 500, color: "#FAFAFA" }}>{(p.denomination / USDC).toLocaleString("en-US")}</strong>
                </span>
              ))}
            </div>
            <dl style={S.dl}>
              <div style={S.dlRow}>
                <dt style={{ color: "#A1A1AA" }}>Deposited</dt>
                <dd style={S.dd}>{formatUsdc(q.gross)} USDC</dd>
              </div>
              <div style={S.dlRow}>
                <dt style={{ color: "#A1A1AA" }}>Fee 0.25%</dt>
                <dd style={S.dd}>{formatUsdc(q.fee)} USDC</dd>
              </div>
              <div style={{ ...S.dlRow, borderBottom: 0, fontWeight: 600 }}>
                <dt>Added to private balance</dt>
                <dd style={S.dd}>{formatUsdc(q.net)} USDC</dd>
              </div>
            </dl>
            <div style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", borderLeft: "2px solid #EF3340", background: "rgba(8,8,10,0.7)", fontSize: 14, color: "#D4D4D8" }}>
              <strong style={{ fontWeight: 600, color: "#FAFAFA" }}>Public on C-Chain:</strong> sender and amounts. Private after this.
            </div>
            {!active || active.status === "done" ? (
              <button type="button" onClick={start} disabled={!!wallet && (!canDeposit || busy || !info)} className="vt-cta" style={S.cta}>
                {!wallet ? "Unlock to deposit" : busy ? "Signing…" : canDeposit ? `Deposit ${(q.gross / USDC).toLocaleString("en-US")} USDC` : odd ? "Enter a multiple of 10 USDC" : "Enter at least 20 USDC"}
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div role="status" className={active.status === "waiting" ? "pulse" : undefined} style={{ ...S.ok, fontSize: 14, color: active.status === "waiting" ? "#F5C66B" : "#6EE7A8" }}>
                  {statusText}
                </div>
                {active.status === "waiting" && config?.usdcIsMock && (
                  <button type="button" onClick={faucet} style={{ ...S.ghost, minHeight: 48 }}>
                    Testnet faucet: send {formatUsdc(active.gross)} test USDC to this address
                  </button>
                )}
                {active.status === "waiting" && config && !config.usdcIsMock && config.network === "fuji" && (
                  <p style={{ ...S.hint, margin: 0 }}>
                    Need test USDC? Open the{" "}
                    <a href={CIRCLE_FAUCET} target="_blank" rel="noreferrer" style={{ color: "#FAFAFA" }}>
                      Circle faucet
                    </a>
                    , choose Avalanche Fuji and paste this address. Send exactly {formatUsdc(active.gross)} USDC in total.
                  </p>
                )}
                {(active.status === "failed" || active.status === "expired") && (
                  <button type="button" onClick={retry} disabled={busy} className="vt-cta" style={{ ...S.cta, minHeight: 48 }}>
                    {busy ? "Signing…" : "Sign again and retry"}
                  </button>
                )}
                {(active.status === "failed" || active.status === "expired") && (
                  <button
                    type="button"
                    onClick={() => {
                      setDismissed((d) => [...d, active.address]);
                      setActive(null);
                    }}
                    style={{ ...S.ghost, minHeight: 44 }}
                  >
                    Start a new deposit instead
                  </button>
                )}
              </div>
            )}
            {active?.status === "done" && <p style={{ ...S.ok, margin: 0 }}>{statusText}</p>}
            {err && <p role="alert" style={S.error}>{err}</p>}
          </section>
        </div>
      </main>
    </Shell>
  );
}
