"use client";
import Link from "next/link";
import { useState } from "react";
import { formatUsdc, type HistoryItem } from "@vatanta/sdk";
import { Shell } from "@/components/Shell";
import { ActionBar } from "@/components/ActionBar";
import { Redact } from "@/components/Redact";
import { countdown, plural, useNextBatch, useSession } from "@/lib/session";
import { MONO, S } from "@/lib/ui";
import { Art, Eyebrow } from "@/components/Art";

const GLYPH: Record<HistoryItem["kind"], string> = { send: "↗", deposit: "↓", receive: "↙", withdraw: "↑", split: "⇣", merge: "⇄" };

function title(h: HistoryItem) {
  switch (h.kind) {
    case "send":
      return "Private send";
    case "receive":
      return "Private receive";
    case "deposit":
      return h.pieces ? `Deposit · ${plural(h.pieces, "piece")}` : "Deposit";
    case "withdraw":
      return `Withdrawal · ${plural(h.pieces ?? 0, "piece")}`;
    case "split":
      return `Prepare ${plural(h.pieces ?? 0, "piece")}`;
    case "merge":
      return "Combine notes";
  }
}

function sub(h: HistoryItem) {
  switch (h.kind) {
    case "send":
      return `To ${h.counterparty}`;
    case "receive":
      return "From a shielded address";
    case "deposit":
      return `From ${h.counterparty ?? "C-Chain"}`;
    case "withdraw":
      return `To ${h.counterparty}`;
    default:
      return "Inside the pool";
  }
}

function status(h: HistoryItem) {
  if (h.status === "queued") return `Queued · ${h.detail ?? ""}`;
  if (h.status === "pending") return h.detail ? `Pending · ${h.detail}` : "Pending";
  if (h.status === "failed") return `Failed${h.detail ? ` · ${h.detail}` : ""}`;
  return "Confirmed";
}

export default function WalletPage() {
  const { wallet, version } = useSession();
  const [show, setShow] = useState(false);
  const next = useNextBatch();
  void version;
  const balance = wallet?.balance() ?? 0n;
  const pending = wallet?.pendingBalance() ?? 0n;
  const notes = wallet?.spendable().length ?? 0;
  const rows = wallet?.history() ?? [];
  const balClear = show;
  const [whole, frac] = formatUsdc(balance).split(".");

  return (
    <Shell active="wallet">
      <main style={{ ...S.main, gap: 32 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Eyebrow>YOUR WALLET</Eyebrow>
            <h1 style={S.h1}>Wallet</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px 12px 12px", background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)), #111114", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" }}>
            <span aria-hidden="true" style={{ width: 42, height: 42, borderRadius: 11, background: "radial-gradient(circle at 30% 20%, #5E0F19, #2A0D12)", border: "1px solid rgba(239,51,64,0.55)", boxShadow: "0 0 24px -6px rgba(239,51,64,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EF3340" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 600 }}>{wallet?.rootOk === false ? "Root check failed" : "Privacy active"}</span>
              {wallet?.rootOk === false && <span style={{ fontSize: 13, color: "#A1A1AA" }}>Indexer data disagrees with the chain</span>}
            </div>
          </div>
        </div>

        <section aria-labelledby="bal-h" style={{ position: "relative", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 22, overflow: "hidden", ...S.redGlow }}>
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "28px 28px", WebkitMaskImage: "radial-gradient(60% 90% at 70% 30%, #000, transparent)", maskImage: "radial-gradient(60% 90% at 70% 30%, #000, transparent)", pointerEvents: "none" }} />
          <Art kind="vault" className="vt-hide-md" style={{ position: "absolute", top: -22, right: 236, width: 300, height: "auto", pointerEvents: "none" }} />
          <div style={{ position: "relative", padding: "34px 32px 30px", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 24 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h2 id="bal-h" style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "#E4E4E7" }}>
                  Private balance
                </h2>
                <button type="button" className="vt-ghost" onClick={() => setShow(!show)} style={{ minHeight: 32, padding: "0 12px", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 999, background: "rgba(9,9,11,0.55)", color: "#FAFAFA", fontSize: 12.5, cursor: "pointer" }}>
                  {show ? "Hide" : "Show"}
                </button>
              </div>
              {balClear ? (
                <div style={{ fontFamily: MONO, fontSize: 52, fontWeight: 500, lineHeight: 1.1, letterSpacing: "-0.02em", textShadow: "0 0 40px rgba(239,51,64,0.25)" }}>
                  {whole}
                  {frac ? `.${frac}` : ""} <span style={{ fontSize: 20, color: "#A1A1AA" }}>USDC</span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 57 }}>
                  <Redact width={300} height={40} cap={4} label="Balance hidden" style={{ maxWidth: "52vw", borderRadius: 4 }} />
                  <span style={{ fontFamily: MONO, fontSize: 20, color: "#A1A1AA" }}>USDC</span>
                </div>
              )}
              {balClear && pending > 0n && <span style={{ fontSize: 13, color: "#A1A1AA" }}>+ {formatUsdc(pending)} USDC settling</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 999, background: "rgba(9,9,11,0.65)", border: "1px solid rgba(255,255,255,0.12)", fontSize: 13, WebkitBackdropFilter: "blur(6px)", backdropFilter: "blur(6px)" }}>
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF3340" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                Only you can see this
              </span>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px 24px", textAlign: "right", fontSize: 13, padding: "12px 16px", borderRadius: 12, background: "rgba(9,9,11,0.55)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <dt style={{ color: "#A1A1AA" }}>Notes</dt>
                <dd style={{ margin: 0, fontFamily: MONO }}>{balClear ? notes : <Redact width={28} height={12} cap={2} />}</dd>
                <dt style={{ color: "#A1A1AA" }}>Next batch</dt>
                <dd style={{ margin: 0, fontFamily: MONO }}>{countdown(next)}</dd>
              </dl>
            </div>
          </div>
          <div style={{ position: "relative", padding: "0 32px 28px" }}>
            <ActionBar />
          </div>
          <div style={{ position: "relative", padding: "14px 32px", borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(9,9,11,0.6)", display: "flex", flexWrap: "wrap", gap: "8px 28px", fontSize: 13, color: "#A1A1AA" }}>
            <span>
              Private send <span style={{ color: "#FAFAFA", fontFamily: MONO }}>$0.10</span>
            </span>
            <span>
              Deposit / withdraw <span style={{ color: "#FAFAFA", fontFamily: MONO }}>0.25%</span>
            </span>
            <span>
              Minimum deposit <span style={{ color: "#FAFAFA", fontFamily: MONO }}>$20</span>
            </span>
            <span>No gas needed</span>
          </div>
        </section>

        <section id="activity" aria-labelledby="act-h" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Eyebrow>HISTORY</Eyebrow>
              <h2 id="act-h" style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>
                Recent activity
              </h2>
            </div>
            <Link href="/verify" className="vt-ghost" style={{ display: "inline-flex", alignItems: "center", minHeight: 40, padding: "0 16px", borderRadius: 10, border: "1px solid rgba(239,51,64,0.35)", background: "rgba(239,51,64,0.06)", color: "#FF6B75", textDecoration: "none", fontWeight: 500, fontSize: 14 }}>
              Verify the pool ↗
            </Link>
          </div>
          <div style={S.table}>
            <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th scope="col" style={{ ...S.th, padding: "14px 24px" }}>TRANSACTION</th>
                  <th scope="col" style={{ ...S.th, padding: "14px 16px" }}>PRIVACY</th>
                  <th scope="col" style={{ ...S.th, padding: "14px 16px" }}>STATUS</th>
                  <th scope="col" style={{ ...S.th, padding: "14px 24px", textAlign: "right" }}>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: "28px 24px", color: "#A1A1AA" }}>
                      No activity yet. <Link href="/deposit" style={{ color: "#EF3340" }}>Make a deposit</Link>
                    </td>
                  </tr>
                )}
                {rows.slice(0, 25).map((r) => {
                  const amtClear = !r.isPrivate || show;
                  return (
                    <tr key={r.id} className="vt-row">
                      <td style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                          <span aria-hidden="true" style={{ width: 40, height: 40, flex: "none", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, color: r.isPrivate ? "#FF6B75" : "#D4D4D8", background: r.isPrivate ? "linear-gradient(180deg, rgba(239,51,64,0.16), rgba(239,51,64,0.04))" : "linear-gradient(180deg, #1E1E23, #16161A)", border: `1px solid ${r.isPrivate ? "rgba(239,51,64,0.35)" : "rgba(255,255,255,0.08)"}` }}>
                            {GLYPH[r.kind]}
                          </span>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontWeight: 500 }}>{title(r)}</span>
                            <span style={{ fontSize: 13, color: "#A1A1AA", fontFamily: MONO }}>{sub(r)}</span>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        {r.isPrivate ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "3px 10px", borderRadius: 999, background: "rgba(239,51,64,0.10)", border: "1px solid rgba(239,51,64,0.4)", color: "#FF8A93", fontSize: 12.5 }}><span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", background: "#EF3340" }} />Hidden</span>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "3px 10px", borderRadius: 999, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "#E4E4E7", fontSize: 12.5 }}><span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", background: "#A1A1AA" }} />Public on C-Chain</span>
                        )}
                      </td>
                      <td style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.06)", color: "#D4D4D8" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <span aria-hidden="true" className={r.status === "pending" || r.status === "queued" ? "pulse" : undefined} style={{ width: 7, height: 7, flex: "none", borderRadius: "50%", background: r.status === "failed" ? "#EF3340" : r.status === "confirmed" ? "#2FBF71" : "#F2B33D" }} />
                          {status(r)}
                        </span>
                      </td>
                      <td style={{ padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: "right" }}>
                        {amtClear ? (
                          <span style={{ fontFamily: MONO, fontWeight: 500 }}>{formatUsdc(r.amount, { sign: true })}</span>
                        ) : (
                          <Redact width={110} height={16} label="Amount hidden" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </Shell>
  );
}
