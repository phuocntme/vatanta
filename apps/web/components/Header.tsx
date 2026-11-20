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

const pill = { display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 14px", border: "1px solid #29292D", borderRadius: 999, background: "#171719" } as const;

export function Header({ active }: { active: NavKey }) {
  const { eoa, config, info, requestUnlock } = useSession();
  const net = config?.network === "fuji" ? "Fuji testnet" : config ? "Local network" : "Connecting…";
  return (
    <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 32px", borderBottom: "1px solid #29292D", background: "#09090B", color: "#FAFAFA", fontSize: 15 }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", minHeight: 44 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={36} height={36} style={{ display: "block", borderRadius: 8 }} />
        <span style={{ fontWeight: 600, fontSize: 17 }}>{BRAND}</span>
      </Link>
      <nav aria-label="Main" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {NAV.map((n) =>
          n.key === section(active) ? (
            <Link key={n.key} href={n.href} aria-current="page" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 14px", textDecoration: "none", fontWeight: 600, color: "#FAFAFA", boxShadow: "inset 0 -2px 0 #EF3340" }}>
              {n.label}
            </Link>
          ) : (
            <Link key={n.key} href={n.href} style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 14px", textDecoration: "none", color: "#A1A1AA" }}>
              {n.label}
            </Link>
          ),
        )}
      </nav>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span style={pill} title={info ? `Relayer ${info.relayer}` : "Relayer unreachable"}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: info ? "#2FBF71" : "#F2B33D" }} />
          {net}
        </span>
        {!eoa && (
          <button type="button" onClick={requestUnlock} disabled={!config} style={{ ...pill, color: "#FAFAFA", fontWeight: 600, cursor: "pointer", borderColor: "#8F1725" }}>
            Connect wallet
          </button>
        )}
        <AccountMenu />
      </div>
    </header>
  );
}
