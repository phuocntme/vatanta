import type { CSSProperties } from "react";

/** Hidden value: solid black bar with red end caps (never asterisks). */
export function Redact({ width, height = 16, cap = 3, label = "Hidden", block = false, style }: { width: number | string; height?: number; cap?: number; label?: string; block?: boolean; style?: CSSProperties }) {
  return (
    <span
      role="img"
      aria-label={label}
      style={{
        display: block ? "block" : "inline-block",
        width,
        maxWidth: "100%",
        height,
        verticalAlign: "middle",
        background: "#000000",
        borderLeft: `${cap}px solid #EF3340`,
        borderRight: `${cap}px solid #EF3340`,
        borderRadius: cap,
        ...style,
      }}
    />
  );
}
