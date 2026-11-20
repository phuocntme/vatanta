import type { CSSProperties } from "react";

/** Shared inline style tokens for the web app screens. */
export const MONO = "var(--font-mono), 'IBM Plex Mono', ui-monospace, monospace";

export const S = {
  main: { maxWidth: 1120, margin: "0 auto", padding: "40px 32px 72px", display: "flex", flexDirection: "column", gap: 28 } as CSSProperties,
  back: { display: "inline-flex", alignItems: "center", minHeight: 32, color: "#A1A1AA", textDecoration: "none", fontSize: 14 } as CSSProperties,
  h1: { margin: 0, fontSize: 40, fontWeight: 600, lineHeight: 1.1, letterSpacing: "-0.01em" } as CSSProperties,
  eyebrow: { fontSize: 12, letterSpacing: "0.14em", color: "#A1A1AA" } as CSSProperties,
  lead: { margin: 0, color: "#A1A1AA", maxWidth: 680 } as CSSProperties,
  grid2: (min: number) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, gap: 24, alignItems: "start" }) as CSSProperties,
  card: { background: "#171719", border: "1px solid #29292D", borderRadius: 16, padding: 28, display: "flex", flexDirection: "column", gap: 20 } as CSSProperties,
  h2: { margin: 0, fontSize: 16, fontWeight: 600 } as CSSProperties,
  label: { fontSize: 14, color: "#A1A1AA" } as CSSProperties,
  input: { minHeight: 56, padding: "0 16px", border: "1px solid #3F3F46", borderRadius: 12, background: "#09090B", color: "#FAFAFA", fontFamily: MONO, fontSize: 24, boxSizing: "border-box", width: "100%" } as CSSProperties,
  hint: { fontSize: 13, color: "#A1A1AA" } as CSSProperties,
  cta: { minHeight: 56, border: 0, borderRadius: 12, background: "#EF3340", color: "#09090B", fontSize: 16, fontWeight: 600, cursor: "pointer" } as CSSProperties,
  ghost: { minHeight: 44, padding: "0 16px", border: "1px solid #3F3F46", borderRadius: 10, background: "#232326", color: "#FAFAFA", cursor: "pointer" } as CSSProperties,
  dl: { margin: 0, display: "flex", flexDirection: "column", borderTop: "1px solid #29292D" } as CSSProperties,
  dlRow: { display: "flex", justifyContent: "space-between", gap: 16, padding: "12px 0", borderBottom: "1px solid #29292D" } as CSSProperties,
  dd: { margin: 0, fontFamily: MONO } as CSSProperties,
  warn: { padding: "14px 16px", borderRadius: 12, border: "1px solid #8A6A1F", background: "#231B09", color: "#F5C66B", fontSize: 14 } as CSSProperties,
  error: { margin: 0, fontSize: 14, color: "#FF8A93" } as CSSProperties,
  ok: { fontSize: 13, color: "#6EE7A8" } as CSSProperties,
  redGlow: { background: "radial-gradient(120% 140% at 100% 0%, #8F1725 0%, #3A0A12 35%, #171719 70%)" } as CSSProperties,
  softGlow: { border: "1px solid #8F1725", background: "radial-gradient(140% 160% at 100% 0%, #3A0A12 0%, #171719 60%)" } as CSSProperties,
};

export const shortHex = (h: string, head = 6, tail = 4) => (h.length > head + tail + 1 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h);
