import type { CSSProperties, ReactNode } from "react";

/**
 * Decorative isometric illustrations (purely visual, aria-hidden). One per screen, drawn in the
 * product palette: graphite prisms, hairline strokes, red accents.
 */
export type ArtKind = "vault" | "deposit" | "send" | "receive" | "withdraw" | "verify";

const RED = "#EF3340";
const LINE = "rgba(255,255,255,0.16)";
const FAINT = "rgba(255,255,255,0.07)";
const K = 0.29; // isometric height ratio (tan 30° / 2)

type Pt = [number, number];
const pts = (p: Pt[]) => p.map((q) => q.join(",")).join(" ");

/** An isometric slab centred at (cx, cy) on its top face. */
function Prism({ cx, cy, w, t = 10, accent = false, top, glow = false, opacity = 1 }: { cx: number; cy: number; w: number; t?: number; accent?: boolean; top?: string; glow?: boolean; opacity?: number }) {
  const h = w * K;
  const L: Pt = [cx - w / 2, cy];
  const T: Pt = [cx, cy - h];
  const R: Pt = [cx + w / 2, cy];
  const B: Pt = [cx, cy + h];
  return (
    <g opacity={opacity}>
      {glow && <ellipse cx={cx} cy={cy + t + h * 0.6} rx={w * 0.62} ry={h * 0.9} fill="url(#vt-glow)" />}
      <polygon points={pts([L, B, [B[0], B[1] + t], [L[0], L[1] + t]])} fill={accent ? "#5E0F19" : "#121215"} stroke={accent ? RED : LINE} strokeWidth="1" />
      <polygon points={pts([R, B, [B[0], B[1] + t], [R[0], R[1] + t]])} fill={accent ? "#3B0911" : "#0C0C0E"} stroke={accent ? RED : LINE} strokeWidth="1" />
      <polygon points={pts([L, T, R, B])} fill={top ?? (accent ? "url(#vt-red)" : "url(#vt-top)")} stroke={accent ? "#FF6B75" : "rgba(255,255,255,0.24)"} strokeWidth="1" />
    </g>
  );
}

/** Point on the top face of a slab: u runs left→top edge, v runs left→bottom edge (both 0..1). */
const onTop = (cx: number, cy: number, w: number, u: number, v: number): Pt => {
  const h = w * K;
  return [cx - w / 2 + (u + v) * (w / 2), cy - u * h + v * h];
};

function Shield({ x, y, s = 1, color = "#FFF" }: { x: number; y: number; s?: number; color?: string }) {
  return (
    <g transform={`translate(${x - 12 * s} ${y - 12 * s}) scale(${s})`} fill="none" stroke={color} strokeWidth={1.8 / s} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </g>
  );
}

function Node({ x, y, r = 4, live = false, color = RED }: { x: number; y: number; r?: number; live?: boolean; color?: string }) {
  return (
    <g>
      {live && <circle className="vt-ping" cx={x} cy={y} r={r} fill={color} />}
      <circle cx={x} cy={y} r={r + 3} fill="#09090B" stroke={color} strokeOpacity="0.5" />
      <circle cx={x} cy={y} r={r - 1} fill={color} />
    </g>
  );
}

function Defs() {
  return (
    <defs>
      <linearGradient id="vt-top" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#26262C" />
        <stop offset="1" stopColor="#141417" />
      </linearGradient>
      <linearGradient id="vt-red" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#FF5A66" />
        <stop offset="1" stopColor="#B81E2D" />
      </linearGradient>
      <radialGradient id="vt-glow">
        <stop offset="0" stopColor={RED} stopOpacity="0.45" />
        <stop offset="1" stopColor={RED} stopOpacity="0" />
      </radialGradient>
      <pattern id="vt-dots" width="12" height="12" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.8" fill="rgba(255,255,255,0.12)" />
      </pattern>
    </defs>
  );
}

/* ─────────────── scenes ─────────────── */

function Vault() {
  const cx = 200, cy = 150;
  return (
    <>
      <g className="vt-spin" style={{ transformOrigin: `${cx}px ${cy + 20}px` }}>
        <ellipse cx={cx} cy={cy + 20} rx="170" ry="52" fill="none" stroke={FAINT} strokeDasharray="2 6" />
      </g>
      <ellipse cx={cx} cy={cy + 20} rx="128" ry="38" fill="none" stroke="rgba(239,51,64,0.28)" />
      <Prism cx={cx} cy={cy + 52} w={210} t={12} opacity={0.75} />
      <Prism cx={cx} cy={cy + 20} w={176} t={12} glow />
      <g className="vt-float">
        <Prism cx={cx} cy={cy - 16} w={132} t={14} accent />
        <Shield x={cx} y={cy - 18} s={1.4} />
      </g>
      <Node x={cx - 128} y={cy + 20} live />
      <Node x={cx + 112} y={cy + 38} r={3} color="#A1A1AA" />
      <Node x={cx + 60} y={cy - 16} r={3} color="#A1A1AA" />
      <path className="vt-flow" d={`M ${cx - 128} ${cy + 20} Q ${cx - 120} ${cy - 50} ${cx - 40} ${cy - 40}`} fill="none" stroke={RED} strokeOpacity="0.7" />
    </>
  );
}

function DepositScene() {
  const cx = 220, cy = 112;
  return (
    <>
      {[["10", 70, 44], ["100", 120, 34], ["1K", 170, 50]].map(([l, x, y]) => (
        <g key={l as string}>
          <path className="vt-flow" d={`M ${x} ${(y as number) + 12} C ${x} ${cy - 20}, ${cx - 30} ${cy - 30}, ${cx - 12} ${cy - 8}`} fill="none" stroke={RED} strokeOpacity="0.55" />
          <Prism cx={x as number} cy={y as number} w={38} t={5} />
        </g>
      ))}
      <Prism cx={cx} cy={cy + 18} w={170} t={14} glow />
      <Prism cx={cx} cy={cy - 6} w={110} t={12} accent />
      <Shield x={cx} y={cy - 8} s={1.1} />
    </>
  );
}

function SendScene() {
  const ay = 118, bx = 330;
  return (
    <>
      <Prism cx={70} cy={ay} w={92} t={10} />
      <Node x={70} y={ay - 2} live />
      <Prism cx={bx} cy={ay} w={92} t={10} />
      <Node x={bx} y={ay - 2} color="#A1A1AA" />
      <path className="vt-flow" d={`M 70 ${ay - 6} C 110 30, 160 30, 200 52`} fill="none" stroke={RED} strokeOpacity="0.8" />
      <path className="vt-flow" d={`M 200 52 C 240 30, 290 30, ${bx} ${ay - 6}`} fill="none" stroke={RED} strokeOpacity="0.8" />
      <g className="vt-float">
        <polygon points={pts([[200, 26], [224, 40], [224, 66], [200, 80], [176, 66], [176, 40]])} fill="url(#vt-red)" stroke="#FF6B75" />
        <text x="200" y="58" textAnchor="middle" fontFamily="var(--font-sans), system-ui, sans-serif" fontSize="16" fill="#FFF">π</text>
      </g>
    </>
  );
}

function ReceiveScene() {
  const cx = 200, cy = 104, w = 150;
  const cells: ReactNode[] = [];
  const n = 7;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if ((i * 7 + j * 3 + i * j) % 3 === 0 || (i < 2 && j < 2) || (i < 2 && j > 4) || (i > 4 && j < 2)) {
        const a = onTop(cx, cy, w * 0.78, i / n, j / n);
        const b = onTop(cx, cy, w * 0.78, (i + 0.8) / n, j / n);
        const c = onTop(cx, cy, w * 0.78, (i + 0.8) / n, (j + 0.8) / n);
        const d = onTop(cx, cy, w * 0.78, i / n, (j + 0.8) / n);
        cells.push(<polygon key={`${i}-${j}`} points={pts([a, b, c, d])} fill={(i + j) % 5 === 0 ? RED : "rgba(255,255,255,0.75)"} />);
      }
    }
  return (
    <>
      <Prism cx={cx} cy={cy} w={w} t={14} glow />
      {cells}
      {[[60, 40], [340, 50], [330, 150]].map(([x, y], k) => (
        <g key={k}>
          <path className="vt-flow" d={`M ${x} ${y} Q ${(x + cx) / 2} ${y - 10} ${cx + (x < cx ? -40 : 40)} ${cy - 6}`} fill="none" stroke={RED} strokeOpacity="0.55" />
          <Node x={x} y={y} r={3} color={k === 0 ? RED : "#A1A1AA"} live={k === 0} />
        </g>
      ))}
    </>
  );
}

function WithdrawScene() {
  const y0 = 150;
  return (
    <>
      <line x1="20" y1={y0} x2="380" y2={y0} stroke={LINE} />
      {Array.from({ length: 10 }, (_, i) => (
        <g key={i}>
          <line x1={40 + i * 36} y1={y0 - 4} x2={40 + i * 36} y2={y0 + 4} stroke={LINE} />
        </g>
      ))}
      <Prism cx={70} cy={70} w={80} t={12} accent glow />
      <Shield x={70} y={68} s={0.8} />
      {[[148, 108], [220, 88], [292, 116], [356, 96]].map(([x, y], k) => (
        <g key={k}>
          <path className="vt-flow" d={`M 92 ${76} C 120 ${76}, ${x - 30} ${y - 10}, ${x - 14} ${y - 2}`} fill="none" stroke={RED} strokeOpacity="0.5" />
          <Prism cx={x} cy={y} w={30} t={5} />
          <line x1={x} y1={y + 10} x2={x} y2={y0 - 4} stroke={RED} strokeOpacity="0.35" strokeDasharray="2 3" />
          <circle cx={x} cy={y0} r="3" fill={RED} />
        </g>
      ))}
    </>
  );
}

function VerifyScene() {
  const cx = 200, cy = 96, R = 78;
  const ring = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return [cx + Math.cos(a) * R * 1.5, cy + Math.sin(a) * R * 0.62] as Pt;
  });
  return (
    <>
      <ellipse cx={cx} cy={cy} rx={R * 1.5} ry={R * 0.62} fill="none" stroke={FAINT} />
      <ellipse cx={cx} cy={cy} rx={R * 0.9} ry={R * 0.37} fill="none" stroke="rgba(239,51,64,0.25)" strokeDasharray="2 5" />
      {ring.map(([x, y], i) => (
        <line key={`l${i}`} x1={x} y1={y} x2={cx} y2={cy} stroke={i % 2 ? LINE : RED} strokeOpacity={i % 2 ? 1 : 0.5} className={i % 2 ? undefined : "vt-flow"} />
      ))}
      {ring.map(([x, y], i) => (
        <line key={`r${i}`} x1={x} y1={y} x2={ring[(i + 1) % 6][0]} y2={ring[(i + 1) % 6][1]} stroke={FAINT} />
      ))}
      <Prism cx={cx} cy={cy + 4} w={86} t={12} accent glow />
      <Shield x={cx} y={cy + 2} s={0.95} />
      {ring.map(([x, y], i) => (
        <Node key={`n${i}`} x={x} y={y} r={3.5} color={i === 4 ? "#A1A1AA" : "#2FBF71"} live={i === 1} />
      ))}
    </>
  );
}

const SCENES: Record<ArtKind, { box: string; el: () => ReactNode }> = {
  vault: { box: "0 0 400 260", el: Vault },
  deposit: { box: "0 0 400 190", el: DepositScene },
  send: { box: "0 0 400 190", el: SendScene },
  receive: { box: "0 0 400 190", el: ReceiveScene },
  withdraw: { box: "0 0 400 190", el: WithdrawScene },
  verify: { box: "0 0 400 190", el: VerifyScene },
};

export function Art({ kind, style, className }: { kind: ArtKind; style?: CSSProperties; className?: string }) {
  const s = SCENES[kind];
  const El = s.el;
  return (
    <svg aria-hidden="true" focusable="false" viewBox={s.box} className={className} style={{ display: "block", overflow: "visible", ...style }}>
      <Defs />
      <El />
    </svg>
  );
}

/**
 * Title band used at the top of every screen: the bare h1 on a blueprint panel with the screen's
 * illustration on the right. `eyebrow` and `aside` keep whatever the screen already showed there.
 */
export function PageHero({ title, kind, eyebrow, aside, id }: { title: string; kind: ArtKind; eyebrow?: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div
      className="vt-card"
      style={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 20,
        minHeight: 168,
        padding: "28px 32px",
        boxSizing: "border-box",
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.08)",
        background:
          "radial-gradient(70% 120% at 100% 50%, rgba(239,51,64,0.16) 0%, rgba(239,51,64,0) 60%), linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.005)), #0E0E11",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
    >
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "14px 14px", WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 55%)", maskImage: "linear-gradient(90deg, transparent 0%, #000 55%)", pointerEvents: "none" }} />
      <Corners />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 10, zIndex: 1 }}>
        {eyebrow}
        <h1 id={id} style={{ margin: 0, fontSize: 40, fontWeight: 600, lineHeight: 1.1, letterSpacing: "-0.01em" }}>{title}</h1>
        {aside}
      </div>
      <Art kind={kind} className="vt-hide-sm" style={{ position: "relative", width: 360, maxWidth: "48%", height: "auto", margin: "-18px -8px -22px 0" }} />
    </div>
  );
}

/** Thin corner brackets, the "frame" motif used on hero panels and the QR codes. */
export function Corners({ color = "rgba(255,255,255,0.22)", size = 12, inset = 10 }: { color?: string; size?: number; inset?: number }) {
  const b = `1px solid ${color}`;
  const c: CSSProperties = { position: "absolute", width: size, height: size, pointerEvents: "none" };
  return (
    <span aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <span style={{ ...c, top: inset, left: inset, borderTop: b, borderLeft: b }} />
      <span style={{ ...c, top: inset, right: inset, borderTop: b, borderRight: b }} />
      <span style={{ ...c, bottom: inset, left: inset, borderBottom: b, borderLeft: b }} />
      <span style={{ ...c, bottom: inset, right: inset, borderBottom: b, borderRight: b }} />
    </span>
  );
}

/** Eyebrow label with the red status tick. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, letterSpacing: "0.14em", color: "#A1A1AA" }}>
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 1, background: RED, boxShadow: "0 0 10px rgba(239,51,64,0.8)" }} />
      {children}
    </span>
  );
}
