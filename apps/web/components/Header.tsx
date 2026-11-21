"use client";
import Link from "next/link";
import { useSession } from "@/lib/session";
import { BRAND } from "@/lib/brand";
import { AccountMenu } from "./AccountMenu";

export type NavKey = "wallet" | "send" | "receive" | "withdraw" | "verify" | "deposit";
// Send / Receive / Withdraw / Deposit are reached from the Wallet screen's buttons, so the nav only
// has the two top-level screens; Wallet stays highlighted on its sub-screens.
const NAV: { key: NavKey; label: string; href: string }[] = [
  { key: "wallet", label: "Wallet", href: "/" },
  { key: "verify", label: "Verify", href: "/verify" },
];
const section = (k: NavKey): NavKey => (k === "verify" ? "verify" : "wallet");

const pill = { display: "inline-flex", alignItems: "center", gap: 8, minHeight: 38, padding: "0 14px", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 999, background: "rgba(23,23,27,0.8)" } as const;

export function Header({ active }: { active: NavKey }) {
  const { eoa, config, info, requestUnlock } = useSession();
  const net = config?.network === "fuji" ? "Fuji testnet" : config ? "Local network" : "Connecting…";
  return (
    <header className="vt-header" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 32px", borderBottom: "1px solid rgba(255,255,255,0.07)", color: "#FAFAFA", fontSize: 15 }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", minHeight: 44 }}>
        <span style={{ position: "relative", display: "block", borderRadius: 10, padding: 1, background: "linear-gradient(140deg, rgba(239,51,64,0.9), rgba(255,255,255,0.08) 60%)", boxShadow: "0 0 24px -6px rgba(239,51,64,0.6)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={34} height={34} style={{ display: "block", borderRadius: 9 }} />
        </span>
        <span style={{ fontWeight: 600, fontSize: 17 }}>{BRAND}</span>
      </Link>
      <nav aria-label="Main" className="vt-nav" style={{ display: "flex", flexWrap: "wrap", gap: 2, padding: 4, borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(17,17,20,0.7)" }}>
        {NAV.map((n) =>
          n.key === section(active) ? (
            <Link key={n.key} href={n.href} aria-current="page" style={{ position: "relative", display: "inline-flex", alignItems: "center", minHeight: 36, padding: "0 16px", borderRadius: 8, textDecoration: "none", fontWeight: 600, color: "#FAFAFA", background: "linear-gradient(180deg, #232328, #1A1A1E)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -2px 0 #EF3340" }}>
              {n.label}
            </Link>
          ) : (
            <Link key={n.key} href={n.href} style={{ display: "inline-flex", alignItems: "center", minHeight: 36, padding: "0 16px", borderRadius: 8, textDecoration: "none", color: "#A1A1AA" }}>
              {n.label}
            </Link>
          ),
        )}
      </nav>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span style={pill} title={info ? `Relayer ${info.relayer}` : "Relayer unreachable"}>
          <span aria-hidden="true" className={info ? "vt-live" : undefined} style={{ width: 7, height: 7, borderRadius: "50%", background: info ? "#2FBF71" : "#F2B33D", boxShadow: info ? "0 0 8px #2FBF71" : "none" }} />
          {net}
        </span>
        {!eoa && (
          <button type="button" className="vt-cta" onClick={requestUnlock} disabled={!config} style={{ ...pill, border: 0, color: "#09090B", fontWeight: 600, cursor: "pointer", background: "linear-gradient(180deg, #F2434F 0%, #E02A38 100%)", boxShadow: "0 6px 20px -8px rgba(239,51,64,0.7), inset 0 1px 0 rgba(255,255,255,0.3)" }}>
            Connect wallet
          </button>
        )}
        <AccountMenu />
      </div>
    </header>
  );
}

export function Footer() {
  const { config, info } = useSession();
  const net = config?.network === "fuji" ? "Fuji testnet" : config ? "Local network" : "Connecting…";
  return (
    <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(9,9,11,0.6)" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 32px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px 24px", fontSize: 13, color: "#71717A" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 1, background: "#EF3340" }} />
          {BRAND}
        </span>
        <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "6px 18px" }}>
          <span>
            {net} · Relayer <span style={{ color: info ? "#6EE7A8" : "#F5C66B" }}>{info ? "online" : "offline"}</span>
          </span>
          <Link href="/verify" style={{ color: "#A1A1AA", textDecoration: "none" }}>
            Verify the pool ↗
          </Link>
        </span>
      </div>
    </footer>
  );
}
