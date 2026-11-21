"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  formatEta,
  formatUsdc,
  matchesRecentDeposit,
  parseUsdc,
  pickBatches,
  quoteWithdraw,
  SEND_FEE,
  USDC,
  type OwnedNote,
  type PreparedTx,
  type TimingMode,
  type WithdrawDestination,
} from "@vatanta/sdk";
import { Shell } from "@/components/Shell";
import { ActionBar } from "@/components/ActionBar";
import { countdown, everyText, plural, useNextBatch, useSession } from "@/lib/session";
import { MONO, S, shortHex } from "@/lib/ui";
import { PageHero } from "@/components/Art";

const MODES: { key: TimingMode; label: string; desc: string; tag: string }[] = [
  { key: "fast", label: "Fast", desc: "All pieces in the next batch", tag: "Weakest" },
  { key: "standard", label: "Standard", desc: "Each piece at a random batch within 6 hours", tag: "Default" },
  { key: "max", label: "Max", desc: "Each piece at a random batch within 24 hours", tag: "Strongest" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// own chevron: the native select arrow sits flush against the border and ignores the input padding
const CHEVRON = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A1A1AA" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>')}")`;
const SELECT = {
  ...S.input,
  fontFamily: "inherit",
  fontSize: 16,
  appearance: "none",
  WebkitAppearance: "none",
  paddingRight: 48,
  backgroundImage: CHEVRON,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 18px center",
  cursor: "pointer",
} as const;

export default function WithdrawPage() {
  const s = useSession();
  const { wallet, info, relayer, ctx, prover, version } = s;
  void version;
  const [amount, setAmount] = useState("2,350");
  const [mode, setMode] = useState<TimingMode>("standard");
  // "" = C-Chain; otherwise the blockchain id of an L1 from the DestinationRegistry (SPEC §14)
  const [destId, setDestId] = useState("");
  const destinations = info?.destinations ?? [];
  const dest: WithdrawDestination | null = destinations.find((d) => d.blockchainId === destId) ?? null;
  const destName = dest?.name ?? "C-Chain";
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const next = useNextBatch();
  const interval = info?.batchIntervalSecs ?? 600;
  const balance = wallet?.balance() ?? 0n;
  const q = useMemo(() => quoteWithdraw(parseUsdc(amount), wallet ? balance : undefined), [amount, balance, wallet]);
  // client-chosen batches, re-rolled when the plan changes
  const [seed, setSeed] = useState(0);
  const batches = useMemo(() => pickBatches(q.pieces.length, mode, Math.floor(Date.now() / 1000), interval), [q.pieces.length, mode, interval, seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const exits = wallet?.peekExitAddresses(q.pieces.length) ?? [];
  const pattern = wallet ? matchesRecentDeposit(q.gross, wallet.recentDepositTotals()) : false;
  const now = Math.floor(Date.now() / 1000);
  const busy = progress !== null;

  const plan = q.pieces.map((d, k) => {
    const a = wallet?.anonymitySet(d) ?? { n: 0, level: "red" as const };
    return {
      d,
      addr: exits[k],
      // times are random/clock-based: render them only once mounted (next !== null) so SSR matches
      when: mode === "fast" ? `Next batch · in ${countdown(next)}` : next === null ? "Random batch" : `Random batch ${formatEta(batches[k] ?? now, now)}`,
      ...a,
    };
  });

  const run = async () => {
    if (!wallet) return s.requestUnlock();
    if (!relayer || !ctx || !q.ok) return;
    setErr(null);
    setDone(null);
    try {
      const target = q.gross + SEND_FEE;
      const merges = wallet.mergesNeeded(target);
      if (merges === null) throw new Error("Not enough private balance.");
      for (let i = 0; i < merges; i++) {
        setProgress(`Combining notes (${i + 1}/${merges})…`);
        const m = await wallet.prepareMerge({ ctx, prover });
        const r = await relayer.transfer(m.proof.proof, m.args);
        await wallet.markSubmitted(m as PreparedTx<unknown>, r.txHash);
        await waitFor(() => !wallet.state.pendingSpent.some((n) => m.spent.includes(n)));
      }
      setProgress("Generating split proof on your device…");
      const before = new Set(wallet.withdrawablePieces().map((p) => p.nullifier.toString()));
      const sp = await wallet.prepareSplit({ gross: q.gross, ctx, prover });
      setProgress("Relayer is submitting the split…");
      const r = await relayer.split(sp.proof.proof, sp.args);
      await wallet.markSubmitted(sp as PreparedTx<unknown>, r.txHash);
      let pieces: OwnedNote[] = [];
      await waitFor(() => {
        pieces = wallet.withdrawablePieces().filter((p) => !before.has(p.nullifier.toString()));
        return pieces.length >= sp.pieces.length;
      });
      // keep the client's random offsets, re-anchored to "now" so every batch is still ahead
      const t = Math.floor(Date.now() / 1000);
      const chosen = pickBatches(pieces.length, mode, t, interval);
      setProgress(`Generating ${pieces.length} withdrawal proofs…`);
      const ws = await wallet.prepareWithdrawals({ pieces, batches: chosen, ctx, prover, destination: dest });
      setProgress("Handing pieces to the relayer queue…");
      await relayer.schedule(ws.map((w) => ({ batch: w.batch, proof: w.proof.proof, args: w.args })));
      setDone(`${plural(ws.length, "piece")} scheduled to ${destName}.`);
      setSeed((x) => x + 1);
      s.bump();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 90; i++) {
      await s.sync();
      if (cond()) return;
      await sleep(1000);
    }
    throw new Error("Timed out waiting for the L1");
  };

  const mine = [...(wallet?.withdrawals() ?? [])].sort((a, b) => b.batch - a.batch).slice(0, 12);
  const queued = mine.filter((w) => w.status === "queued");

  return (
    <Shell active="withdraw">
      <main style={S.main}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Link href="/" style={S.back}>← Wallet</Link>
          <div style={{ margin: "4px 0 12px" }}>
            <ActionBar active="withdraw" compact />
          </div>
          <PageHero title="Withdraw" kind="withdraw" />
        </div>
        <div style={S.grid2(420)}>
          <section aria-labelledby="w-h" className="vt-card" style={{ ...S.card, gap: 22 }}>
            <h2 id="w-h" style={S.h2}>Withdrawal</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label htmlFor="w-amt" style={S.label}>Amount (USDC)</label>
              <input id="w-amt" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} style={S.input} />
              <span style={S.hint}>Multiples of 10. The rest stays private.</span>
              {!q.ok && q.error && <span style={{ fontSize: 13, color: "#FF8A93" }}>{q.error}</span>}
            </div>
            {pattern && (
              <div role="alert" style={S.warn}>
                You deposited exactly this amount recently. Withdrawing the same total makes the two easy to match. Try a different amount, or choose Max timing.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label htmlFor="w-dest" style={S.label}>Receive on</label>
              <select id="w-dest" value={destId} onChange={(e) => setDestId(e.target.value)} disabled={busy} style={SELECT}>
                <option value="">C-Chain</option>
                {destinations.map((d) => (
                  <option key={`${d.blockchainId}-${d.tokenRemote}`} value={d.blockchainId}>
                    {d.name} · chain {d.evmChainId}
                  </option>
                ))}
              </select>
              {dest && <span style={S.hint}>Falls back to C-Chain if {dest.name} can&apos;t take it.</span>}
            </div>
            <fieldset style={{ margin: 0, padding: 0, border: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <legend style={{ fontSize: 14, color: "#A1A1AA", marginBottom: 10 }}>Timing</legend>
              {MODES.map((m) => {
                const on = m.key === mode;
                return (
                  <button
                    key={m.key}
                    type="button"
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => setMode(m.key)}
                    className="vt-ghost"
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, minHeight: 62, padding: "0 16px", border: `1px solid ${on ? "rgba(239,51,64,0.8)" : "rgba(255,255,255,0.08)"}`, borderRadius: 12, background: on ? "linear-gradient(90deg, rgba(239,51,64,0.18), rgba(239,51,64,0.04))" : "#0B0B0E", boxShadow: on ? "0 0 0 3px rgba(239,51,64,0.10), inset 3px 0 0 #EF3340" : "none", color: "#FAFAFA", textAlign: "left", cursor: "pointer" }}
                  >
                    <span style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 600 }}>{m.label}</span>
                      <span style={{ fontSize: 13, color: on ? "#D4D4D8" : "#A1A1AA" }}>{m.desc}</span>
                    </span>
                    <span style={{ fontSize: 13, padding: "2px 10px", borderRadius: 999, border: `1px solid ${on ? "rgba(239,51,64,0.5)" : "rgba(255,255,255,0.1)"}`, color: on ? "#FF8A93" : "#A1A1AA" }}>{m.tag}</span>
                  </button>
                );
              })}
            </fieldset>
            <dl style={S.dl}>
              <div style={S.dlRow}>
                <dt style={{ color: "#A1A1AA" }}>Withdrawn</dt>
                <dd style={S.dd}>{formatUsdc(q.gross)} USDC</dd>
              </div>
              <div style={S.dlRow}>
                <dt style={{ color: "#A1A1AA" }}>Fee 0.25%</dt>
                <dd style={S.dd}>{formatUsdc(q.fee)} USDC</dd>
              </div>
              <div style={{ ...S.dlRow, borderBottom: 0, fontWeight: 600 }}>
                <dt>You receive on {destName}</dt>
                <dd style={S.dd}>{formatUsdc(q.net)} USDC</dd>
              </div>
            </dl>
            <button type="button" onClick={run} disabled={!!wallet && (!q.ok || busy || !ctx)} className="vt-cta" style={S.cta}>
              {!wallet ? "Unlock to withdraw" : (progress ?? `Schedule ${plural(q.pieces.length, "piece")}`)}
            </button>
            <span style={{ ...S.hint, marginTop: -10 }}>Includes one 0.10 USDC private send.</span>
            {err && <p role="alert" style={S.error}>{err}</p>}
            {done && <p role="status" style={{ ...S.ok, fontSize: 14, margin: 0 }}>{done}</p>}
          </section>

          <section aria-labelledby="plan-h" className="vt-card" style={{ ...S.card, padding: 0, gap: 0, overflow: "hidden" }}>
            <div style={{ padding: "28px 28px 22px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", gap: 6 }}>
              <h2 id="plan-h" style={S.h2}>Withdrawal plan</h2>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
              {plan.map((p, k) => (
                <li key={k} className="vt-row" style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr) 132px", gap: 14, alignItems: "center", padding: "14px 28px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontFamily: MONO, fontWeight: 500 }}><span aria-hidden="true" style={{ width: 8, height: 8, transform: "rotate(45deg)", border: "1px solid #EF3340", background: "rgba(239,51,64,0.25)" }} />{(p.d / USDC).toLocaleString("en-US")}</span>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontFamily: MONO, fontSize: 13, color: "#D4D4D8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>→ fresh {p.addr ? shortHex(p.addr) : "…"}{dest ? ` on ${dest.name}` : ""}</span>
                    <span style={{ fontSize: 12, color: "#A1A1AA" }}>{p.when}</span>
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span aria-hidden="true" style={{ display: "block", height: 6, borderRadius: 3, background: "#222227" }}>
                      <span style={{ display: "block", width: p.level === "green" ? "100%" : p.level === "yellow" ? "50%" : "15%", height: 6, borderRadius: 3, background: p.level === "green" ? "#2FBF71" : p.level === "yellow" ? "#F2B33D" : "#EF3340" }} />
                    </span>
                    <span style={{ fontSize: 12, color: p.level === "green" ? "#6EE7A8" : p.level === "yellow" ? "#F5C66B" : "#FF8A93" }}>{p.level === "red" ? `Only ${p.n} · wait` : `${p.n} could be you`}</span>
                  </span>
                </li>
              ))}
              {plan.length === 0 && <li style={{ padding: "20px 28px", color: "#A1A1AA", fontSize: 14 }}>Enter an amount to see the pieces.</li>}
            </ul>
            {mine.length > 0 && (
              <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ padding: "16px 28px 6px", fontSize: 13, color: "#A1A1AA" }}>
                  Your scheduled pieces · {plural(queued.length, "piece")} waiting
                </div>
                <ul style={{ margin: 0, padding: "0 0 8px", listStyle: "none" }}>
                  {mine.map((w) => (
                    <li key={w.nullifier.toString()} style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr) auto", gap: 14, alignItems: "center", padding: "8px 28px", fontSize: 13 }}>
                      <span style={{ fontFamily: MONO }}>{(w.denomination / USDC).toLocaleString("en-US")}</span>
                      <span style={{ fontFamily: MONO, color: "#D4D4D8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>→ {shortHex(w.recipient)}{w.destination ? ` on ${w.destination}` : ""}</span>
                      {w.status === "sent" ? (
                        <span style={{ color: "#6EE7A8" }}>Sent{w.tx ? ` · ${shortHex(w.tx)}` : ""}</span>
                      ) : (
                        <span style={{ color: "#F5C66B" }}>Leaves {formatEta(w.batch, now)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ padding: "16px 28px", display: "flex", flexWrap: "wrap", gap: "8px 20px", fontSize: 13, color: "#A1A1AA" }}>
              <span><span style={{ color: "#6EE7A8" }}>●</span> 20+ people</span>
              <span><span style={{ color: "#F5C66B" }}>●</span> 5–19</span>
              <span><span style={{ color: "#FF8A93" }}>●</span> under 5</span>
              <span>Batches run {everyText(interval).toLowerCase()}</span>
            </div>
          </section>
        </div>
      </main>
    </Shell>
  );
}
