"use client";
import { useEffect, type ReactNode } from "react";
import { Footer, Header, type NavKey } from "./Header";
import { useSession } from "@/lib/session";
import { UNLOCK_PENDING, UnlockDialog } from "./UnlockDialog";

export function Shell({ active, children, requireWallet = true }: { active: NavKey; children: ReactNode; requireWallet?: boolean }) {
  const { wallet, error, config, restoring, unlockOpen, requestUnlock } = useSession();
  const locked = requireWallet && !wallet;
  // back from the Google / X redirect: reopen the dialog so it can ask for the key signature
  useEffect(() => {
    try {
      if (!wallet && sessionStorage.getItem(UNLOCK_PENDING) === "1") requestUnlock();
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="vt-app" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#09090B", color: "#FAFAFA" }}>
      <Header active={active} />
      {error && (
        <div role="alert" style={{ background: "#231B09", color: "#F5C66B", textAlign: "center", padding: "8px 16px", fontSize: 13, borderBottom: "1px solid #8A6A1F" }}>
          {error}
        </div>
      )}
      {locked && (
        <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "8px 16px", padding: "10px 16px", background: "linear-gradient(90deg, rgba(239,51,64,0) 0%, rgba(239,51,64,0.10) 50%, rgba(239,51,64,0) 100%), #0E0E11", borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: 14, color: "#D4D4D8" }}>
          {restoring && !error ? (
            <span className="pulse">Unlocking your private balance…</span>
          ) : (
            <>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF3340" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                Locked · unlock to continue
              </span>
              <button type="button" className="vt-cta" onClick={requestUnlock} disabled={!config && !error} style={{ minHeight: 34, padding: "0 18px", border: 0, borderRadius: 999, background: "linear-gradient(180deg, #F2434F 0%, #E02A38 100%)", color: "#09090B", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Unlock
              </button>
            </>
          )}
        </div>
      )}
      <div style={{ flex: 1 }}>{children}</div>
      <Footer />
      {unlockOpen && !wallet && <UnlockDialog loading={!config && !error} />}
    </div>
  );
}
