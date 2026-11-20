"use client";
import { useEffect, type ReactNode } from "react";
import { Header, type NavKey } from "./Header";
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
    <div style={{ minHeight: "100vh", background: "#09090B", color: "#FAFAFA" }}>
      <Header active={active} />
      {error && (
        <div role="alert" style={{ background: "#231B09", color: "#F5C66B", textAlign: "center", padding: "8px 16px", fontSize: 13, borderBottom: "1px solid #8A6A1F" }}>
          {error}
        </div>
      )}
      {locked && (
        <div role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "8px 16px", padding: "10px 16px", background: "#171719", borderBottom: "1px solid #29292D", fontSize: 14, color: "#D4D4D8" }}>
          {restoring && !error ? (
            <span className="pulse">Unlocking your private balance…</span>
          ) : (
            <>
              <span>Locked · unlock to see your private balance and use this screen.</span>
              <button type="button" onClick={requestUnlock} disabled={!config && !error} style={{ minHeight: 36, padding: "0 16px", border: 0, borderRadius: 999, background: "#EF3340", color: "#09090B", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Unlock
              </button>
            </>
          )}
        </div>
      )}
      {children}
      {unlockOpen && !wallet && <UnlockDialog loading={!config && !error} />}
    </div>
  );
}
