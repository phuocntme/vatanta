"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useSession } from "@/lib/session";
import { useAuth } from "@/lib/auth";
import { MONO, shortHex } from "@/lib/ui";

const C = { panel: "#111113", pill: "#171719", line: "#29292D", text: "#FAFAFA", muted: "#A1A1AA", red: "#EF3340" };
const pill: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, padding: "0 14px", border: `1px solid ${C.line}`, borderRadius: 999, background: C.pill };
const item: CSSProperties = { display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 44, padding: "0 12px", border: 0, borderRadius: 10, background: "transparent", color: C.text, fontSize: 14, textAlign: "left", cursor: "pointer" };

const Icon = {
  user: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="5.5" r="2.75" /><path d="M2.75 13.5c.8-2.4 2.8-3.75 5.25-3.75s4.45 1.35 5.25 3.75" strokeLinecap="round" /></svg>,
  out: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2.75H3.75a1 1 0 00-1 1v8.5a1 1 0 001 1H6M10.5 11l3-3-3-3M13.5 8H6.5" /></svg>,
  caret: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4.5L6 7.5 9 4.5" /></svg>,
  close: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l10 10M14 4L4 14" /></svg>,
};

/** Header account pill: opens a menu with Profile and Log out (clicking the pill no longer locks). */
export function AccountMenu() {
  const { eoa, disconnect } = useSession();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!eoa) return null;
  return (
    <div ref={root} style={{ position: "relative" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} style={{ ...pill, fontFamily: MONO, color: C.text, cursor: "pointer" }}>
        {shortHex(eoa, 6, 4)}
        <span aria-hidden="true" style={{ color: C.muted, display: "inline-flex" }}>{Icon.caret}</span>
      </button>
      {open && (
        <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 40, minWidth: 200, padding: 6, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`, boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}>
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); setProfile(true); }} style={item}>
            <span aria-hidden="true" style={{ color: C.muted, display: "inline-flex" }}>{Icon.user}</span>
            Profile
          </button>
          <div aria-hidden="true" style={{ height: 1, margin: "4px 6px", background: C.line }} />
          <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); disconnect(); }} style={{ ...item, color: "#FF8A93" }}>
            <span aria-hidden="true" style={{ display: "inline-flex" }}>{Icon.out}</span>
            Log out
          </button>
        </div>
      )}
      {profile && <ProfileDialog onClose={() => setProfile(false)} />}
    </div>
  );
}

function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { eoa, eoaKind, config, disconnect } = useSession();
  const auth = useAuth();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!eoa) return null;

  const signIn = eoaKind === "demo" ? "Demo account (this browser only)" : auth.account ? [auth.account.method, auth.account.id].filter(Boolean).join(" · ") : "Wallet";
  const walletType = eoaKind === "demo" ? "Burner key in this browser" : auth.walletLabel ? auth.walletLabel.replace(/^\w/, (c) => c.toUpperCase()) : "Wallet";
  const network = config?.network === "fuji" ? "Avalanche Fuji testnet" : "Local network";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(eoa);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "14px 0", borderTop: `1px solid ${C.line}` }}>
      <span style={{ fontSize: 13, color: C.muted }}>{label}</span>
      <div style={{ fontSize: 15, color: C.text, wordBreak: "break-all" }}>{value}</div>
    </div>
  );

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(6,6,7,0.78)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="profile-h" style={{ boxSizing: "border-box", width: "100%", maxWidth: 440, padding: "clamp(24px, 6vw, 32px)", borderRadius: 24, background: C.panel, border: `1px solid ${C.line}`, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", color: C.text, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
          <h2 id="profile-h" style={{ margin: 0, fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>Profile</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ flex: "none", width: 32, height: 32, margin: "-4px -6px 0 0", border: 0, borderRadius: 8, background: "transparent", color: C.muted, display: "grid", placeItems: "center", cursor: "pointer" }}>
            {Icon.close}
          </button>
        </div>
        {row("Signed in with", signIn)}
        {row(
          "Wallet address (public, C-Chain)",
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, fontSize: 14 }}>{eoa}</span>
            <button type="button" onClick={copy} style={{ ...pill, minHeight: 32, padding: "0 12px", color: C.text, fontSize: 13, cursor: "pointer" }}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>,
        )}
        {row("Wallet type", walletType)}
        {row("Network", network)}
        {row(
          "Private address",
          <Link href="/receive" onClick={onClose} style={{ color: C.text, textDecorationColor: C.red, textUnderlineOffset: 3 }}>
            Show on Receive
          </Link>,
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, minHeight: 48, borderRadius: 12, border: `1px solid ${C.line}`, background: C.pill, color: C.text, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Close
          </button>
          <button type="button" onClick={() => { onClose(); disconnect(); }} style={{ flex: 1, minHeight: 48, borderRadius: 12, border: 0, background: C.red, color: "#FFF", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            Log out
          </button>
        </div>
      </section>
    </div>
  );
}
