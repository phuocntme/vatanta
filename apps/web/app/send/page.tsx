"use client";
import Link from "next/link";
import { useState } from "react";
import { formatUsdc, isValidAddress, parseUsdc, SEND_FEE, type PreparedTx, type ProofResult, type TransferPublic } from "@vatanta/sdk";
import { Shell } from "@/components/Shell";
import { ActionBar } from "@/components/ActionBar";
import { ProofInspector } from "@/components/ProofInspector";
import { useSession } from "@/lib/session";
import { MONO, S } from "@/lib/ui";
import { PageHero } from "@/components/Art";

const LABELS = ["Proof on your device", "Submitted by relayer", "Confirmed on L1"];
const CTA = ["Generate proof and send", "Generating proof…", "Waiting for block…", "Sent · send another"];

export default function SendPage() {
  const s = useSession();
  const { wallet, relayer, ctx, prover } = s;
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("250.00");
  const [step, setStep] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [last, setLast] = useState<{ proof: ProofResult; args: TransferPublic; tx?: string } | null>(null);
  const amt = parseUsdc(amount);
  const valid = isValidAddress(to);
  const balance = wallet?.balance() ?? 0n;
  const enough = amt > 0n && amt + SEND_FEE <= balance;

  const send = async () => {
    if (step === 3) {
      setStep(0);
      setLast(null);
      setNote(null);
      return;
    }
    if (!wallet) return s.requestUnlock();
    if (!relayer || !ctx || !valid || !enough) return;
    setErr(null);
    setStep(1);
    try {
      // Two-input circuit: combine notes first when the amount needs more than two of them.
      const merges = wallet.mergesNeeded(amt + SEND_FEE);
      if (merges === null) throw new Error("Not enough private balance.");
      for (let i = 0; i < merges; i++) {
        setNote(`Combining notes first (${i + 1}/${merges}, 0.10 USDC each)…`);
        const m = await wallet.prepareMerge({ ctx, prover });
        const r = await relayer.transfer(m.proof.proof, m.args);
        await wallet.markSubmitted(m as PreparedTx<unknown>, r.txHash);
        await waitConfirmed(r.txHash);
      }
      setNote(null);
      const t = await wallet.prepareTransfer({ to: to.trim(), amount: amt, ctx, prover });
      setLast({ proof: t.proof, args: t.args });
      setStep(2);
      const r = await relayer.transfer(t.proof.proof, t.args);
      await wallet.markSubmitted(t as PreparedTx<unknown>, r.txHash);
      setLast({ proof: t.proof, args: t.args, tx: r.txHash });
      setStep(3);
      s.sync();
    } catch (e) {
      setErr((e as Error).message);
      setStep(0);
      setNote(null);
    }
  };

  const waitConfirmed = async (tx: string) => {
    for (let i = 0; i < 30; i++) {
      await s.sync();
      if (wallet?.history().find((h) => h.tx === tx && h.status === "confirmed")) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  const status = (i: number) => (step > i ? "Done" : step === i + 1 && step > 0 ? "In progress" : "Waiting");
  const stepsDone = step === 3 ? 3 : step - 1;

  return (
    <Shell active="send">
      <main style={S.main}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Link href="/" style={S.back}>← Wallet</Link>
          <div style={{ margin: "4px 0 12px" }}>
            <ActionBar active="send" compact />
          </div>
          <PageHero title="Send privately" kind="send" />
        </div>
        <div style={S.grid2(420)}>
          <form aria-labelledby="send-h" onSubmit={(e) => e.preventDefault()} className="vt-card" style={{ ...S.card, margin: 0 }}>
            <h2 id="send-h" style={S.h2}>Payment</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label htmlFor="to" style={S.label}>Recipient shielded address</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id="to" type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="zk1…" spellCheck={false} style={{ flex: 1, minWidth: 0, minHeight: 52, boxSizing: "border-box", padding: "0 14px", border: "1px solid #2E2E34", borderRadius: 12, background: "#08080A", color: "#FAFAFA", fontFamily: MONO, fontSize: 14 }} />
                <button
                  type="button"
                  aria-label="Paste address"
                  title="Paste from clipboard"
                  onClick={async () => setTo((await navigator.clipboard.readText()).trim())}
                  className="vt-ghost"
                  style={{ minWidth: 52, minHeight: 52, border: "1px solid #34343B", borderRadius: 12, background: "#18181C", color: "#FAFAFA", cursor: "pointer" }}
                >
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
                  </svg>
                </button>
              </div>
              {to && (valid ? <span style={S.ok}>Valid shielded address</span> : <span style={{ fontSize: 13, color: "#FF8A93" }}>Not a valid zk1 address</span>)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label htmlFor="amt" style={S.label}>Amount (USDC)</label>
              <input id="amt" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={S.input} />
              <span style={S.hint}>
                {wallet ? `Available: ${formatUsdc(balance)} USDC` : "Never shown on-chain"}
              </span>
              {wallet && amt > 0n && !enough && <span style={{ fontSize: 13, color: "#FF8A93" }}>Not enough private balance (amount + 0.10 fee).</span>}
            </div>
            <dl style={S.dl}>
              <div style={S.dlRow}>
                <dt style={{ color: "#A1A1AA" }}>Network fee</dt>
                <dd style={S.dd}>0.10 USDC</dd>
              </div>
              <div style={{ ...S.dlRow, borderBottom: 0 }}>
                <dt style={{ color: "#A1A1AA" }}>Paid from</dt>
                <dd style={{ margin: 0 }}>Private balance · no gas</dd>
              </div>
            </dl>
            <button type="button" onClick={send} disabled={!!wallet && ((step === 0 && (!valid || !enough || !ctx)) || step === 1 || step === 2)} className="vt-cta" style={S.cta}>
              {!wallet ? "Unlock to send" : step === 1 && last === null && note ? note : CTA[step]}
            </button>
            {err && <p role="alert" style={S.error}>{err}</p>}
            <ol aria-label="Progress" style={{ margin: 0, padding: 14, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, borderRadius: 12, background: "rgba(8,8,10,0.6)", border: "1px solid rgba(255,255,255,0.06)" }}>
              {LABELS.map((l, i) => (
                <li key={l} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span aria-hidden="true" style={{ display: "block", height: 4, borderRadius: 2, background: stepsDone > i ? "linear-gradient(90deg, #B81E2D, #EF3340)" : "#26262B", boxShadow: stepsDone > i ? "0 0 12px rgba(239,51,64,0.6)" : "none" }} />
                  <span style={{ fontSize: 13, color: "#D4D4D8" }}>{l}</span>
                  <span style={{ fontSize: 12, color: "#A1A1AA" }}>{step === 3 ? "Done" : status(i)}</span>
                </li>
              ))}
            </ol>
          </form>

          <ProofInspector proof={last?.proof ?? null} tx={last?.tx} />
        </div>
      </main>
    </Shell>
  );
}
