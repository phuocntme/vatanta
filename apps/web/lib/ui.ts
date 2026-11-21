import type { CSSProperties } from "react";

/** Shared inline style tokens for the web app screens. */
/** Numbers, amounts and addresses. One typeface everywhere (IBM Plex Sans); figures are tabular via body CSS. */
export const MONO = "var(--font-sans), 'IBM Plex Sans', system-ui, sans-serif";

export const S = {
  main: { maxWidth: 1120, margin: "0 auto", padding: "40px 32px 72px", display: "flex", flexDirection: "column", gap: 28 } as CSSProperties,
  back: { display: "inline-flex", alignItems: "center", minHeight: 32, color: "#A1A1AA", textDecoration: "none", fontSize: 14 } as CSSProperties,
  h1: { margin: 0, fontSize: 40, fontWeight: 600, lineHeight: 1.1, letterSpacing: "-0.01em" } as CSSProperties,
  eyebrow: { fontSize: 12, letterSpacing: "0.14em", color: "#A1A1AA" } as CSSProperties,
  lead: { margin: 0, color: "#A1A1AA", maxWidth: 680 } as CSSProperties,
  grid2: (min: number) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(min(${min}px, 100%), 1fr))`, gap: 24, alignItems: "start" }) as CSSProperties,
  card: { background: "linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.01) 100%), #111114", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, padding: 28, display: "flex", flexDirection: "column", gap: 20, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 24px 48px -24px rgba(0,0,0,0.6)" } as CSSProperties,
  h2: { margin: 0, fontSize: 16, fontWeight: 600 } as CSSProperties,
  label: { fontSize: 14, color: "#A1A1AA" } as CSSProperties,
  input: { minHeight: 56, padding: "0 16px", border: "1px solid #2E2E34", borderRadius: 12, background: "#08080A", color: "#FAFAFA", fontFamily: MONO, fontSize: 24, fontWeight: 500, boxSizing: "border-box", width: "100%" } as CSSProperties,
  hint: { fontSize: 13, color: "#A1A1AA" } as CSSProperties,
  cta: { minHeight: 56, border: 0, borderRadius: 12, background: "linear-gradient(180deg, #F2434F 0%, #E02A38 100%)", color: "#09090B", fontSize: 16, fontWeight: 600, cursor: "pointer", boxShadow: "0 8px 24px -10px rgba(239,51,64,0.6), inset 0 1px 0 rgba(255,255,255,0.3)" } as CSSProperties,
  ghost: { minHeight: 44, padding: "0 16px", border: "1px solid #34343B", borderRadius: 10, background: "#18181C", color: "#FAFAFA", cursor: "pointer" } as CSSProperties,
  dl: { margin: 0, display: "flex", flexDirection: "column", borderTop: "1px solid rgba(255,255,255,0.08)" } as CSSProperties,
  dlRow: { display: "flex", justifyContent: "space-between", gap: 16, padding: "13px 0", borderBottom: "1px dashed rgba(255,255,255,0.08)" } as CSSProperties,
  dd: { margin: 0, fontFamily: MONO, fontWeight: 500 } as CSSProperties,
  warn: { padding: "14px 16px", borderRadius: 12, border: "1px solid #8A6A1F", background: "#231B09", color: "#F5C66B", fontSize: 14 } as CSSProperties,
  error: { margin: 0, fontSize: 14, color: "#FF8A93" } as CSSProperties,
  ok: { fontSize: 13, color: "#6EE7A8" } as CSSProperties,
  redGlow: { background: "radial-gradient(90% 120% at 100% 0%, rgba(239,51,64,0.42) 0%, rgba(143,23,37,0.28) 30%, rgba(17,17,20,0) 65%), linear-gradient(180deg, #16161A 0%, #0E0E11 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 40px 80px -40px rgba(239,51,64,0.35)" } as CSSProperties,
  softGlow: { border: "1px solid rgba(239,51,64,0.45)", background: "radial-gradient(140% 160% at 100% 0%, rgba(143,23,37,0.45) 0%, #111114 60%)" } as CSSProperties,
  /** Table shell + header cell, shared by the activity / batches tables. */
  table: { overflowX: "auto", background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)), #111114", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" } as CSSProperties,
  th: { fontWeight: 500, fontSize: 12, letterSpacing: "0.08em", color: "#A1A1AA", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" } as CSSProperties,
  /** Small red tick in front of eyebrow labels. */
  tick: { width: 6, height: 6, borderRadius: 1, background: "#EF3340", boxShadow: "0 0 10px rgba(239,51,64,0.8)" } as CSSProperties,
};

export const shortHex = (h: string, head = 6, tail = 4) => (h.length > head + tail + 1 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h);
