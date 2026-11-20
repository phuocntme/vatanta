"use client";
import Link from "next/link";
import { useState } from "react";
import { formatUsdc, type HistoryItem } from "@vatanta/sdk";
import { Shell } from "@/components/Shell";
import { ActionBar } from "@/components/ActionBar";
import { Redact } from "@/components/Redact";
import { countdown, plural, useNextBatch, useSession } from "@/lib/session";
import { MONO, S } from "@/lib/ui";

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
            <span style={S.eyebrow}>YOUR WALLET</span>
            <h1 style={S.h1}>Wallet</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "#171719", border: "1px solid #29292D", borderRadius: 14 }}>
            <span aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, background: "#2A0D12", border: "1px solid #8F1725", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EF3340" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 600 }}>{wallet?.rootOk === false ? "Root check failed" : "Privacy active"}</span>
              <span style={{ fontSize: 13, color: "#A1A1AA" }}>{wallet?.rootOk === false ? "Indexer data disagrees with the chain" : "Your notes stay encrypted on the L1"}</span>
            </div>
          </div>
        </div>

        <section aria-labelledby="bal-h" style={{ border: "1px solid #29292D", borderRadius: 20, overflow: "hidden", ...S.redGlow }}>
          <div style={{ padding: 32, display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 24 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h2 id="bal-h" style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "#E4E4E7" }}>
                  Private balance
                </h2>
                <button type="button" onClick={() => setShow(!show)} style={{ minHeight: 36, padding: "0 12px", border: "1px solid #3F3F46", borderRadius: 999, background: "rgba(9,9,11,0.5)", color: "#FAFAFA", fontSize: 13, cursor: "pointer" }}>
                  {show ? "Hide" : "Show"}
                </button>
              </div>
              {balClear ? (
                <div style={{ fontFamily: MONO, fontSize: 52, fontWeight: 500, lineHeight: 1.1, letterSpacing: "-0.02em" }}>
                  {whole}
                  {frac ? `.${frac}` : ""} <span style={{ fontSize: 20, color: "#A1A1AA" }}>USDC</span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 14, minHeight: 57 }}>
                  <Redact width={300} height={40} cap={4} label="Balance hidden" style={{ maxWidth: "60vw", borderRadius: 4 }} />
                  <span style={{ fontFamily: MONO, fontSize: 20, color: "#A1A1AA" }}>USDC</span>
                </div>
              )}
              {balClear && pending > 0n && <span style={{ fontSize: 13, color: "#A1A1AA" }}>+ {formatUsdc(pending)} USDC settling</span>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999, background: "rgba(9,9,11,0.6)", border: "1px solid #3F3F46", fontSize: 13 }}>
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF3340" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                Only you can see this
              </span>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "4px 24px", textAlign: "right", fontSize: 13 }}>
                <dt style={{ color: "#A1A1AA" }}>Notes</dt>
                <dd style={{ margin: 0, fontFamily: MONO }}>{balClear ? notes : <Redact width={28} height={12} cap={2} />}</dd>
                <dt style={{ color: "#A1A1AA" }}>Next batch</dt>
                <dd style={{ margin: 0, fontFamily: MONO }}>{countdown(next)}</dd>
              </dl>
            </div>
          </div>
          <div style={{ padding: "0 32px 28px" }}>
            <ActionBar />
          </div>
          <div style={{ padding: "14px 32px", borderTop: "1px solid #29292D", background: "rgba(9,9,11,0.5)", display: "flex", flexWrap: "wrap", gap: "8px 20px", fontSize: 13, color: "#A1A1AA" }}>
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
              <span style={S.eyebrow}>HISTORY</span>
              <h2 id="act-h" style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>
                Recent activity
              </h2>
            </div>
            <Link href="/verify" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, color: "#EF3340", textDecoration: "none", fontWeight: 500 }}>
              Verify the pool ↗
            </Link>
          </div>
          <div style={{ overflowX: "auto", background: "#171719", border: "1px solid #29292D", borderRadius: 16 }}>
            <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#A1A1AA", fontSize: 12, letterSpacing: "0.08em" }}>
                  <th scope="col" style={{ padding: "14px 24px", fontWeight: 500, borderBottom: "1px solid #29292D" }}>TRANSACTION</th>
                  <th scope="col" style={{ padding: "14px 16px", fontWeight: 500, borderBottom: "1px solid #29292D" }}>PRIVACY</th>
                  <th scope="col" style={{ padding: "14px 16px", fontWeight: 500, borderBottom: "1px solid #29292D" }}>STATUS</th>
                  <th scope="col" style={{ padding: "14px 24px", fontWeight: 500, borderBottom: "1px solid #29292D", textAlign: "right" }}>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ padding: "28px 24px", color: "#A1A1AA" }}>
                      No activity yet. <Link href="/deposit" style={{ color: "#EF3340" }}>Make a deposit</Link> to get a private balance.
                    </td>
                  </tr>
                )}
                {rows.slice(0, 25).map((r) => {
                  const amtClear = !r.isPrivate || show;
                  return (
                    <tr key={r.id}>
                      <td style={{ padding: "16px 24px", borderBottom: "1px solid #29292D" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                          <span aria-hidden="true" style={{ width: 40, height: 40, flex: "none", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, background: "#232326", border: "1px solid #29292D" }}>
                            {GLYPH[r.kind]}
                          </span>
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontWeight: 500 }}>{title(r)}</span>
                            <span style={{ fontSize: 13, color: "#A1A1AA", fontFamily: MONO }}>{sub(r)}</span>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: 16, borderBottom: "1px solid #29292D" }}>
                        {r.isPrivate ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "#2A0D12", border: "1px solid #8F1725", color: "#FF8A93", fontSize: 13 }}>Hidden</span>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: 999, background: "#232326", border: "1px solid #3F3F46", color: "#E4E4E7", fontSize: 13 }}>Public on C-Chain</span>
                        )}
                      </td>
                      <td style={{ padding: 16, borderBottom: "1px solid #29292D", color: "#D4D4D8" }}>{status(r)}</td>
                      <td style={{ padding: "16px 24px", borderBottom: "1px solid #29292D", textAlign: "right" }}>
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
