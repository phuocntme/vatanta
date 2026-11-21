"use client";
import Link from "next/link";
import type { CSSProperties } from "react";

export type Action = "deposit" | "send" | "receive" | "withdraw";

const ACTIONS: { key: Action; href: string; l: string; d: string }[] = [
  { key: "deposit", href: "/deposit", l: "Deposit", d: "M12 3v11M7.5 9.5L12 14l4.5-4.5M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14" },
  { key: "send", href: "/send", l: "Send", d: "M21 3L10.5 13.5M21 3l-6.5 18-4-7.5-7.5-4z" },
  { key: "receive", href: "/receive", l: "Receive", d: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM14 19.5v.5M19.5 14h.5" },
  { key: "withdraw", href: "/withdraw", l: "Withdraw", d: "M14 4h6v6M20 4l-9 9M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" },
];

const base: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 12, textDecoration: "none" };
const idle: CSSProperties = { ...base, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(12,12,15,0.7)", color: "#FAFAFA", fontWeight: 500, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" };
const current: CSSProperties = { ...base, border: "1px solid #FF5A66", background: "linear-gradient(180deg, #F2434F 0%, #E02A38 100%)", color: "#09090B", fontWeight: 600, boxShadow: "0 10px 28px -12px rgba(239,51,64,0.8), inset 0 1px 0 rgba(255,255,255,0.3)" };

/**
 * Deposit / Send / Receive / Withdraw. On the Wallet screen none is highlighted; on each function's
 * screen the same bar switches between them and marks the open one.
 */
export function ActionBar({ active, compact = false }: { active?: Action; compact?: boolean }) {
  const box = compact ? 30 : 36;
  return (
    <nav aria-label="Wallet actions" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: compact ? 10 : 12 }}>
      {ACTIONS.map((a) => {
        const on = a.key === active;
        return (
          <Link
            key={a.key}
            href={a.href}
            aria-current={on ? "page" : undefined}
            className={on ? "action-current" : "action-idle"}
            style={{ ...(on ? current : idle), minHeight: compact ? 48 : 58 }}
          >
            <span
              aria-hidden="true"
              className="vt-ico"
              style={{ width: box, height: box, flex: "none", borderRadius: 8, display: "grid", placeItems: "center", border: `1px solid ${on ? "rgba(9,9,11,0.25)" : "rgba(239,51,64,0.3)"}`, background: on ? "rgba(9,9,11,0.14)" : "linear-gradient(180deg, rgba(239,51,64,0.16), rgba(239,51,64,0.04))", color: on ? "#09090B" : "#FF6B75", transition: "border-color 0.15s, color 0.15s" }}
            >
              <svg width={compact ? 16 : 19} height={compact ? 16 : 19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={a.d} />
              </svg>
            </span>
            {a.l}
          </Link>
        );
      })}
    </nav>
  );
}
