"use client";
import Link from "next/link";
import { useState } from "react";
import { formatUsdc } from "@vatanta/sdk";
import { Shell } from "@/components/Shell";
import { ActionBar } from "@/components/ActionBar";
import { QR } from "@/components/QR";
import { useSession } from "@/lib/session";
import { MONO, S } from "@/lib/ui";

const when = (t: number) => {
  const d = new Date(t * 1000);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? "today" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

export default function ReceivePage() {
  const { wallet, version, requestUnlock } = useSession();
  const [copied, setCopied] = useState(false);
  void version;
  const addr = wallet?.address ?? "";
  const incoming = (wallet?.history() ?? []).filter((h) => h.kind === "receive");
  const copy = async () => {
    if (!addr) return requestUnlock();
    await navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const share = async () => {
    if (!addr) return requestUnlock();
    if (navigator.share) await navigator.share({ title: "My shielded address", text: addr }).catch(() => {});
    else copy();
  };
  return (
    <Shell active="receive">
      <main style={S.main}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Link href="/" style={S.back}>← Wallet</Link>
          <div style={{ margin: "4px 0 12px" }}>
            <ActionBar active="receive" compact />
          </div>
          <h1 style={S.h1}>Receive</h1>
        </div>
        <section aria-labelledby="addr-h" style={{ border: "1px solid #29292D", borderRadius: 20, padding: 36, display: "flex", flexWrap: "wrap", gap: 36, alignItems: "center", ...S.redGlow }}>
          {addr ? (
            <QR value={addr} size={220} label="QR code for your shielded address" />
          ) : (
            <span aria-hidden="true" style={{ width: 220, height: 220, borderRadius: 16, border: "1px dashed #3F3F46", background: "rgba(9,9,11,0.55)", display: "flex", alignItems: "center", justifyContent: "center", color: "#71717A", fontSize: 14 }}>
              QR appears after unlock
            </span>
          )}
          <div style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 id="addr-h" style={{ margin: 0, fontSize: 15, fontWeight: 500, color: "#E4E4E7" }}>Your shielded address</h2>
            <code style={{ fontFamily: MONO, fontSize: 18, lineHeight: 1.6, wordBreak: "break-all", padding: "16px 18px", background: "rgba(9,9,11,0.7)", border: "1px solid #3F3F46", borderRadius: 12 }}>{addr || <span style={{ color: "#71717A" }}>zk1… unlock to show your address</span>}</code>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button type="button" onClick={copy} style={{ minHeight: 48, padding: "0 20px", border: 0, borderRadius: 12, background: "#EF3340", color: "#09090B", fontWeight: 600, cursor: "pointer" }}>
                {!addr ? "Unlock to get your address" : copied ? "Copied" : "Copy address"}
              </button>
              <button type="button" onClick={share} style={{ minHeight: 48, padding: "0 20px", border: "1px solid #3F3F46", borderRadius: 12, background: "rgba(9,9,11,0.55)", color: "#FAFAFA", cursor: "pointer" }}>
                Share
              </button>
            </div>
            <p style={{ margin: 0, color: "#D4D4D8" }}>Safe to share. It reveals nothing about your balance or history, and you can reuse it.</p>
          </div>
        </section>
        <section aria-labelledby="in-h" style={{ background: "#171719", border: "1px solid #29292D", borderRadius: 16, padding: "24px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 id="in-h" style={S.h2}>Incoming</h2>
          {incoming.length === 0 && <div style={{ padding: "12px 0", borderTop: "1px solid #29292D", color: "#A1A1AA", fontSize: 14 }}>Nothing yet. Notes sent to you appear here as soon as your device finds them.</div>}
          {incoming.map((h) => (
            <div key={h.id} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "12px 0", borderTop: "1px solid #29292D" }}>
              <span>Private receive · {when(h.time)}</span>
              <span style={{ fontFamily: MONO, fontWeight: 500 }}>+{formatUsdc(h.amount)} USDC</span>
            </div>
          ))}
        </section>
      </main>
    </Shell>
  );
}
