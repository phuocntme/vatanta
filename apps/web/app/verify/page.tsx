"use client";
import { useEffect, useState } from "react";
import { formatUsdc, USDC } from "@vatanta/sdk";
import { Shell } from "@/components/Shell";
import { countdown, everyText, useNextBatch, useSession } from "@/lib/session";
import { MONO, S, shortHex } from "@/lib/ui";

interface Stats {
  bridgeUsdc: string;
  poolUsdc: string;
  notes: number;
  nullifiers: number;
  privateTxs: number;
  root: string;
  crowd: { denomination: string; deposits: number; withdrawals: number; crowd: number }[];
  batches: { batch: number; time: number; privateTxs: number; withdrawals: number; tx: string | null }[];
  validators: { online: number | null; total: number | null };
  withdrawalsByDestination?: { destination: string; denomination: string; withdrawals: number }[];
  contracts: Record<string, string>;
  network: string;
}

const tile = { background: "#171719", border: "1px solid #29292D", borderRadius: 16, padding: 22, display: "flex", flexDirection: "column", gap: 6 } as const;
const big = { fontFamily: MONO, fontSize: 28, fontWeight: 500 } as const;

export default function VerifyPage() {
  const { config, info } = useSession();
  const [st, setSt] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const next = useNextBatch();
  useEffect(() => {
    if (!config) return;
    const load = () =>
      fetch(`${config.indexerUrl}/v1/stats`)
        .then((r) => r.json())
        .then((j) => {
          setSt(j);
          setErr(null);
        })
        .catch(() => setErr("Indexer unreachable. Figures will appear when it is back."));
    load();
    const t = setInterval(load, 5_000);
    return () => clearInterval(t);
  }, [config]);
  const maxCrowd = Math.max(1, ...(st?.crowd.map((c) => c.crowd) ?? [1]));
  const interval = info?.batchIntervalSecs ?? 600;
  const explorer = config?.explorerC;
  // SPEC §14: withdrawals per destination chain × denomination (0x00…0 = C-Chain)
  const DENOMS = [10n, 100n, 1_000n, 10_000n].map((d) => d * USDC);
  const destName = (id: string) =>
    /^0x0*$/.test(id) ? "C-Chain" : (info?.destinations?.find((d) => d.blockchainId.toLowerCase() === id.toLowerCase())?.name ?? shortHex(id, 6, 4));
  const byDest = new Map<string, Map<string, number>>();
  for (const r of st?.withdrawalsByDestination ?? []) {
    const m = byDest.get(r.destination) ?? new Map<string, number>();
    m.set(r.denomination, r.withdrawals);
    byDest.set(r.destination, m);
  }
  const contracts = st
    ? [
        { k: "ShieldedPool", where: "private L1", v: st.contracts.shieldedPool },
        { k: "ICTT TokenHome", where: "C-Chain", v: st.contracts.tokenHome },
        { k: "DepositRouter", where: "C-Chain", v: st.contracts.depositRouter },
        { k: "Verifier and relayer registries", where: "private L1", v: `${shortHex(st.contracts.verifierRegistry)} · ${shortHex(st.contracts.relayerRegistry)}` },
      ]
    : [];
  return (
    <Shell active="verify" requireWallet={false}>
      <main style={S.main}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={S.eyebrow}>PUBLIC · NO LOGIN NEEDED</span>
          <h1 style={S.h1}>Verify the pool</h1>
          <p style={S.lead}>Anyone can see the assets the bridge holds and how large the crowd is for each amount.</p>
        </div>
        {err && <p role="alert" style={S.error}>{err}</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 16 }}>
          <div style={{ ...tile, ...S.softGlow }}>
            <span style={{ fontSize: 13, color: "#D4D4D8" }}>USDC held by the bridge</span>
            <span style={big}>{st ? formatUsdc(BigInt(st.bridgeUsdc)) : "—"}</span>
            <span style={{ fontSize: 12, color: "#A1A1AA" }}>ICTT TokenHome on {config?.network === "fuji" ? "Fuji" : "local"} C-Chain{st ? ` · pool holds ${formatUsdc(BigInt(st.poolUsdc))}` : ""}</span>
          </div>
          <div style={tile}>
            <span style={{ fontSize: 13, color: "#A1A1AA" }}>Notes in the pool</span>
            <span style={big}>{st ? st.notes.toLocaleString("en-US") : "—"}</span>
            <span style={{ fontSize: 12, color: "#A1A1AA" }}>Merkle root {st ? shortHex(st.root) : "—"}</span>
          </div>
          <div style={tile}>
            <span style={{ fontSize: 13, color: "#A1A1AA" }}>Next batch</span>
            <span style={big}>{countdown(next)}</span>
            <span style={{ fontSize: 12, color: "#A1A1AA" }}>{everyText(interval)}</span>
          </div>
          <div style={tile}>
            <span style={{ fontSize: 13, color: "#A1A1AA" }}>Validators online</span>
            <span style={big}>{st?.validators.total ? `${st.validators.online} / ${st.validators.total}` : "—"}</span>
            <span style={{ fontSize: 12, color: "#A1A1AA" }}>Open to new stakers</span>
          </div>
        </div>
        <div style={S.grid2(460)}>
          <section aria-labelledby="anon-h" style={{ ...S.card, gap: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <h2 id="anon-h" style={S.h2}>Crowd size by amount</h2>
              <p style={{ margin: 0, fontSize: 14, color: "#A1A1AA" }}>Unspent deposits of each size. Bigger crowd, stronger privacy.</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {(st?.crowd ?? []).map((c) => (
                <div key={c.denomination} style={{ display: "grid", gridTemplateColumns: "72px minmax(0, 1fr) 48px", gap: 12, alignItems: "center" }}>
                  <span style={{ fontFamily: MONO }}>{(BigInt(c.denomination) / USDC).toLocaleString("en-US")}</span>
                  <span aria-hidden="true" style={{ display: "block", height: 12, borderRadius: 6, background: "#232326" }}>
                    <span style={{ display: "block", width: `${Math.max(2, (c.crowd / maxCrowd) * 100)}%`, height: 12, borderRadius: 6, background: "#EF3340" }} />
                  </span>
                  <span style={{ fontFamily: MONO, textAlign: "right" }}>{c.crowd}</span>
                </div>
              ))}
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#A1A1AA" }}>Testnet figures include simulated traffic.</p>
          </section>
          <section aria-labelledby="cx-h" style={{ ...S.card, gap: 14 }}>
            <h2 id="cx-h" style={S.h2}>Contracts</h2>
            <dl style={{ margin: 0, display: "flex", flexDirection: "column" }}>
              {contracts.map((c) => (
                <div key={c.k} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, padding: "12px 0", borderTop: "1px solid #29292D" }}>
                  <dt>
                    {c.k} <span style={{ color: "#A1A1AA", fontSize: 13 }}>· {c.where}</span>
                  </dt>
                  <dd style={{ margin: 0, fontFamily: MONO, fontSize: 13, color: "#D4D4D8" }} title={c.v}>
                    {c.v.includes("·") ? c.v : shortHex(c.v, 8, 6)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        <section aria-labelledby="b-h" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="b-h" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Recent batches</h2>
          <div style={{ overflowX: "auto", background: "#171719", border: "1px solid #29292D", borderRadius: 16 }}>
            <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#A1A1AA", fontSize: 12, letterSpacing: "0.08em" }}>
                  {["BATCH", "TIME", "PRIVATE TXS", "WITHDRAWALS"].map((h, i) => (
                    <th key={h} scope="col" style={{ padding: i === 0 ? "14px 24px" : "14px 16px", fontWeight: 500, borderBottom: "1px solid #29292D" }}>{h}</th>
                  ))}
                  <th scope="col" style={{ padding: "14px 24px", fontWeight: 500, borderBottom: "1px solid #29292D", textAlign: "right" }}>C-CHAIN TX</th>
                </tr>
              </thead>
              <tbody>
                {(st?.batches ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: "20px 24px", color: "#A1A1AA" }}>No batches yet.</td>
                  </tr>
                )}
                {(st?.batches ?? []).map((b, i, arr) => {
                  const bd = i === arr.length - 1 ? undefined : "1px solid #29292D";
                  return (
                    <tr key={b.batch}>
                      <td style={{ padding: "14px 24px", borderBottom: bd, fontFamily: MONO }}>#{b.batch}</td>
                      <td style={{ padding: "14px 16px", borderBottom: bd, color: "#D4D4D8" }}>{new Date(b.time * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</td>
                      <td style={{ padding: "14px 16px", borderBottom: bd, fontFamily: MONO }}>{b.privateTxs}</td>
                      <td style={{ padding: "14px 16px", borderBottom: bd, fontFamily: MONO }}>{b.withdrawals}</td>
                      <td style={{ padding: "14px 24px", borderBottom: bd, textAlign: "right" }}>
                        {b.tx ? (
                          explorer ? (
                            <a href={`${explorer}/tx/${b.tx}`} target="_blank" rel="noreferrer" style={{ color: "#EF3340", fontFamily: MONO }}>{shortHex(b.tx)} ↗</a>
                          ) : (
                            <span style={{ color: "#EF3340", fontFamily: MONO }} title="L1 transaction that released this batch">{shortHex(b.tx)}</span>
                          )
                        ) : (
                          <span style={{ color: "#A1A1AA" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        {byDest.size > 0 && (
          <section aria-labelledby="d-h" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 id="d-h" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Withdrawals by destination</h2>
            <div style={{ overflowX: "auto", background: "#171719", border: "1px solid #29292D", borderRadius: 16 }}>
              <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#A1A1AA", fontSize: 12, letterSpacing: "0.08em" }}>
                    <th scope="col" style={{ padding: "14px 24px", fontWeight: 500, borderBottom: "1px solid #29292D" }}>CHAIN</th>
                    {DENOMS.map((d) => (
                      <th key={d.toString()} scope="col" style={{ padding: "14px 16px", fontWeight: 500, borderBottom: "1px solid #29292D", textAlign: "right" }}>{(d / USDC).toLocaleString("en-US")} USDC</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...byDest.entries()].map(([id, m], i, arr) => {
                    const bd = i === arr.length - 1 ? undefined : "1px solid #29292D";
                    return (
                      <tr key={id}>
                        <td style={{ padding: "14px 24px", borderBottom: bd }}>{destName(id)}</td>
                        {DENOMS.map((d) => (
                          <td key={d.toString()} style={{ padding: "14px 16px", borderBottom: bd, fontFamily: MONO, textAlign: "right" }}>{m.get(d.toString()) ?? 0}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </Shell>
  );
}
