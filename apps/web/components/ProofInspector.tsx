"use client";
import { useState } from "react";
import type { ProofResult } from "@vatanta/sdk";
import { useSession } from "@/lib/session";
import { MONO, S, shortHex } from "@/lib/ui";
import { Eyebrow } from "./Art";

const NAMES: Record<string, string[]> = {
  transfer: ["root", "nullifier[0]", "nullifier[1]", "out_commitment[0]", "out_commitment[1]", "fee", "relayer", "chain_id", "pool", "ext_data_hash"],
  split: ["root", "nullifier[0]", "nullifier[1]", ...Array.from({ length: 12 }, (_, i) => `denom_commitment[${i}]`), "change_commitment", "fee", "relayer", "chain_id", "pool", "ext_data_hash"],
  withdraw: ["root", "nullifier", "amount", "recipient", "relayer", "chain_id", "pool", "ext_data_hash"],
};

/** Proof inspector (Send screen): what was proven, how big, how long, and an off-chain re-check. */
export function ProofInspector({ proof, tx }: { proof: ProofResult | null; tx?: string }) {
  const { prover } = useSession();
  const [verdict, setVerdict] = useState<null | "checking" | boolean>(null);
  const [open, setOpen] = useState(false);
  const verify = async () => {
    if (!proof || !prover.verify) return;
    setVerdict("checking");
    try {
      setVerdict(await prover.verify(proof.circuit, proof.proof, proof.publicInputs));
    } catch {
      setVerdict(false);
    }
  };
  const names = proof ? NAMES[proof.circuit] ?? [] : [];
  const stat = (label: string, value: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "14px 16px", background: "linear-gradient(180deg, rgba(255,255,255,0.02), transparent), #0A0A0D", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, boxShadow: "inset 2px 0 0 rgba(239,51,64,0.7)" }}>
      <span style={{ fontSize: 12, color: "#A1A1AA" }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 500 }}>{value}</span>
    </div>
  );
  return (
    <section aria-labelledby="pi-h" className="vt-card" style={{ ...S.card, gap: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Eyebrow>ZERO-KNOWLEDGE</Eyebrow>
          <h2 id="pi-h" style={{ ...S.h2, fontSize: 18 }}>Proof inspector</h2>
        </div>
        <button type="button" onClick={verify} disabled={!proof || verdict === "checking"} className="vt-ghost" style={S.ghost}>
          {verdict === "checking" ? "Verifying…" : "Verify locally"}
        </button>
      </div>
      {!proof ? (
        <p style={{ margin: 0, color: "#A1A1AA", fontSize: 14 }}>No proof yet.</p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))", gap: 12 }}>
            {stat("Circuit · UltraHonk", proof.circuit)}
            {stat("Constraints (gates)", proof.meta ? proof.meta.gates.toLocaleString("en-US") : "—")}
            {stat("Proving time", `${(proof.provingMs / 1000).toFixed(2)} s`)}
            {stat("Proof size", `${(proof.proofBytes / 1024).toFixed(1)} KB`)}
          </div>
          {verdict !== null && verdict !== "checking" && (
            <div role="status" style={verdict ? { ...S.ok, fontSize: 14 } : { ...S.error }}>
              {verdict ? "Valid: the proof verifies against the circuit's verification key on this device." : "Verification failed."}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} style={{ alignSelf: "flex-start", background: "none", border: 0, color: "#EF3340", padding: 0, cursor: "pointer", fontWeight: 500 }}>
              {open ? "Hide" : "Show"} {proof.publicInputs.length} public inputs
            </button>
            {open && (
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(140px, auto) 1fr", gap: "6px 16px", fontFamily: MONO, fontSize: 13 }}>
                {proof.publicInputs.map((v, i) => (
                  <div key={i} style={{ display: "contents" }}>
                    <dt style={{ color: "#A1A1AA" }}>{names[i] ?? `input[${i}]`}</dt>
                    <dd style={{ margin: 0, wordBreak: "break-all", color: "#D4D4D8" }}>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "#A1A1AA" }}>
            Witness built in {proof.witnessMs} ms.
            {tx ? ` L1 transaction ${shortHex(tx, 10, 6)}.` : ""}
          </p>
        </>
      )}
    </section>
  );
}
