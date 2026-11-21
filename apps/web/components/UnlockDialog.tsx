"use client";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useSession } from "@/lib/session";
import { useAuth } from "@/lib/auth";
import { shortHex } from "@/lib/ui";

/** Survives the Google / X redirect, so the dialog reopens and asks for the key signature. */
export const UNLOCK_PENDING = "vatanta.unlockPending";
const pending = {
  set: () => { try { sessionStorage.setItem(UNLOCK_PENDING, "1"); } catch {} },
  clear: () => { try { sessionStorage.removeItem(UNLOCK_PENDING); } catch {} },
  get: () => { try { return sessionStorage.getItem(UNLOCK_PENDING) === "1"; } catch { return false; } },
};

const C = { panel: "#111113", line: "#26262A", field: "#0B0B0D", text: "#FAFAFA", muted: "#A1A1AA", red: "#E5383B" };
const tile: CSSProperties = { boxSizing: "border-box", height: 56, borderRadius: 12, fontSize: 17, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, cursor: "pointer" };

const Icon = {
  close: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l10 10M14 4L4 14" /></svg>,
  x: <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l12 12M15 3L3 15" /></svg>,
  arrow: <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 9h11M10 4.5L14.5 9 10 13.5" /></svg>,
  wallet: <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="4.5" width="15" height="11" rx="2" /><path d="M2.5 8h15" /><path d="M13 11.5h2" strokeLinecap="round" /></svg>,
  chevron: <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3.5L10.5 8 6 12.5" /></svg>,
};

/**
 * Unlock dialog, shown over the real screen. Not a native <dialog>.showModal(): that would make
 * Privy's wallet list (portalled to <body>) inert.
 */
export function UnlockDialog({ loading }: { loading: boolean }) {
  const { connectWallet, connectDemo, config, closeUnlock } = useSession();
  const auth = useAuth();
  const box = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const wantSign = useRef(pending.get());

  const close = () => {
    pending.clear();
    closeUnlock();
  };
  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (e: unknown) => setErr((e as Error)?.message || "Something went wrong. Try again.");

  const sign = async () => {
    setBusy("sign");
    setErr(null);
    try {
      await connectWallet();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
      wantSign.current = false;
      pending.clear();
    }
  };

  // once any login method finishes, ask the wallet for the one key-derivation signature
  useEffect(() => {
    if (wantSign.current && auth.authenticated && auth.provider && auth.address && busy !== "sign") sign();
  }, [auth.authenticated, auth.provider, auth.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    setErr(null);
    wantSign.current = true;
  };
  const oauth = async (p: "google" | "twitter") => {
    start();
    pending.set();
    setBusy(p);
    try {
      await auth.oauth(p); // Privy's modal takes over; the effect above signs once logged in
    } catch (e) {
      pending.clear();
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const onEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!(auth.emailStep === "code" ? code.trim() : email.trim())) return;
    start();
    try {
      if (auth.emailStep === "code") await auth.submitCode(code.trim());
      else await auth.sendCode(email.trim());
    } catch (e) {
      fail(e);
    }
  };
  const external = () => {
    start();
    auth.login();
  };
  const demo = async () => {
    setBusy("demo");
    setErr(null);
    try {
      await connectDemo();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const off = loading || !!busy || !auth.enabled || !auth.ready;
  const codeStep = auth.emailStep === "code" || auth.emailStep === "verifying";
  const signedIn = auth.authenticated && !!auth.address;

  return (
    <div onClick={(e) => e.target === e.currentTarget && close()} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(6,6,7,0.72)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto" }}>
      <section ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="unlock-h" style={{ boxSizing: "border-box", width: "100%", maxWidth: 480, padding: "clamp(24px, 6vw, 32px)", borderRadius: 24, background: "radial-gradient(80% 50% at 50% 0%, rgba(239,51,64,0.14), transparent 70%), linear-gradient(180deg, #141418, #0F0F12)", border: "1px solid rgba(255,255,255,0.09)", boxShadow: "0 0 0 1px rgba(0,0,0,0.4), 0 40px 100px -20px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06)", color: C.text, outline: "none", display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 id="unlock-h" style={{ margin: 0, fontSize: 26, fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.01em" }}>Unlock private balance</h2>
            <p style={{ margin: 0, color: C.muted, fontSize: 15 }}>Sign once. Keys stay on this device. No gas.</p>
          </div>
          <button type="button" onClick={close} aria-label="Close" style={{ flex: "none", width: 32, height: 32, margin: "-2px -6px 0 0", border: 0, borderRadius: 8, background: "transparent", color: C.muted, display: "grid", placeItems: "center", cursor: "pointer" }}>
            {Icon.close}
          </button>
        </div>

        {signedIn ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button type="button" disabled={loading || !!busy} onClick={sign} style={{ ...tile, border: 0, background: C.red, color: "#FFF" }}>
              {busy === "sign" ? "Confirm the signature…" : `Continue as ${shortHex(auth.address!)}`}
            </button>
            <button type="button" disabled={!!busy} onClick={() => auth.logout()} style={{ alignSelf: "center", border: 0, background: "none", color: C.muted, fontSize: 14, cursor: "pointer" }}>
              Use another account
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
              <button type="button" disabled={off} onClick={() => oauth("google")} style={{ ...tile, border: 0, background: "#F2F2F2", color: "#0A0A0A" }}>
                <span style={{ fontWeight: 700 }}>G</span> {busy === "google" ? "Opening…" : "Google"}
              </button>
              <button type="button" disabled={off} onClick={() => oauth("twitter")} style={{ ...tile, border: `1px solid ${C.line}`, background: "#161618", color: C.text }}>
                {Icon.x} {busy === "twitter" ? "Opening…" : "X"}
              </button>
            </div>

            <form onSubmit={onEmail} style={{ boxSizing: "border-box", height: 56, display: "flex", alignItems: "center", padding: "0 4px 0 20px", borderRadius: 12, border: `1px solid ${C.line}`, background: C.field }}>
              {codeStep ? (
                <input key="code" aria-label="Code from your email" autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder={`Code sent to ${email}`} value={code} onChange={(e) => setCode(e.target.value)} disabled={off} style={{ flex: 1, minWidth: 0, height: "100%", border: 0, outline: "none", background: "transparent", color: C.text, fontSize: 16 }} />
              ) : (
                <input key="email" aria-label="Email" type="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={off} required style={{ flex: 1, minWidth: 0, height: "100%", border: 0, outline: "none", background: "transparent", color: C.text, fontSize: 16 }} />
              )}
              <button type="submit" aria-label={codeStep ? "Verify code" : "Send code"} disabled={off || auth.emailStep === "sending" || auth.emailStep === "verifying"} style={{ flex: "none", opacity: 1, width: 46, height: 46, border: 0, borderRadius: 9, background: C.red, color: "#FFF", display: "grid", placeItems: "center", cursor: "pointer" }}>
                {auth.emailStep === "sending" || auth.emailStep === "verifying" ? <span className="pulse">…</span> : Icon.arrow}
              </button>
            </form>
            {codeStep && <p style={{ margin: "-8px 0 0", fontSize: 13, color: C.muted }}>Check your inbox for a 6-digit code.</p>}

            <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 16, color: C.muted, fontSize: 14 }}>
              <span style={{ flex: 1, height: 1, background: C.line }} />
              or
              <span style={{ flex: 1, height: 1, background: C.line }} />
            </div>

            <button type="button" disabled={off} onClick={external} style={{ boxSizing: "border-box", display: "flex", alignItems: "center", gap: 16, padding: "14px 20px 14px 16px", borderRadius: 12, border: `1px solid ${C.line}`, background: "#141416", color: C.text, textAlign: "left", cursor: "pointer" }}>
              <span style={{ flex: "none", width: 40, height: 40, borderRadius: 10, background: "#26262A", display: "grid", placeItems: "center", color: "#D4D4D8" }}>{Icon.wallet}</span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 17, fontWeight: 600 }}>{busy === "sign" ? "Confirm the signature…" : "External wallet"}</span>
                <span style={{ fontSize: 14, color: C.muted }}>Core, MetaMask, WalletConnect</span>
              </span>
              <span style={{ color: C.muted, display: "grid" }}>{Icon.chevron}</span>
            </button>
          </>
        )}

        {(err || auth.error) && <p role="alert" style={{ margin: 0, fontSize: 14, color: "#FF8A93" }}>{err || auth.error}</p>}
        {!auth.enabled && <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Login is not configured (set NEXT_PUBLIC_PRIVY_APP_ID).</p>}
        {config?.network !== "fuji" && (
          <button type="button" disabled={loading || !!busy} onClick={demo} style={{ alignSelf: "center", marginTop: -4, border: 0, background: "none", color: C.muted, fontSize: 13, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>
            {busy === "demo" ? "Deriving keys…" : "Use a demo account (local network)"}
          </button>
        )}
      </section>
    </div>
  );
}
