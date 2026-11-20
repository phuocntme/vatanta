"use client";
import Link from "next/link";
import type { CSSProperties } from "react";

export type Action = "deposit" | "send" | "receive" | "withdraw";

const ACTIONS: { key: Action; href: string; g: string; l: string }[] = [
  { key: "deposit", href: "/deposit", g: "↓", l: "Deposit" },
  { key: "send", href: "/send", g: "↗", l: "Send" },
  { key: "receive", href: "/receive", g: "↙", l: "Receive" },
  { key: "withdraw", href: "/withdraw", g: "↑", l: "Withdraw" },
];

const base: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 12, textDecoration: "none" };
const idle: CSSProperties = { ...base, border: "1px solid #3F3F46", background: "rgba(9,9,11,0.55)", color: "#FAFAFA", fontWeight: 500 };
const current: CSSProperties = { ...base, border: "1px solid #EF3340", background: "#EF3340", color: "#09090B", fontWeight: 600 };

/**
 * Deposit / Send / Receive / Withdraw. On the Wallet screen none is highlighted; on each function's
 * screen the same bar switches between them and marks the open one.
 */
export function ActionBar({ active, compact = false }: { active?: Action; compact?: boolean }) {
  return (
    <nav aria-label="Wallet actions" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: compact ? 10 : 12 }}>
      {ACTIONS.map((a) => (
        <Link
          key={a.key}
          href={a.href}
          aria-current={a.key === active ? "page" : undefined}
          className={a.key === active ? "action-current" : "action-idle"}
          style={{ ...(a.key === active ? current : idle), minHeight: compact ? 48 : 56 }}
        >
          <span aria-hidden="true">{a.g}</span>
          {a.l}
        </Link>
      ))}
    </nav>
  );
}
