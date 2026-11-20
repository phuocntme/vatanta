/**
 * Generates real UltraHonk proofs for contracts/test/RealProofs.t.sol:
 * 2 deposits → transfer (A→B) → split (A, 9×100) → withdraw (one 100 piece).
 * Usage: pnpm --filter @vatanta/sdk fixtures
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deriveKeys, Wallet, MemorySource, netOf, USDC, toHex32, type Context } from "../src/index.js";
import { Prover } from "../src/prover/index.js";
import { loadArtifacts } from "../src/node/artifacts.js";

const OUT = join(import.meta.dirname, "..", "..", "contracts", "test", "fixtures");
const ctx: Context = {
  chainId: 31337,
  pool: "0x00000000000000000000000000000000DeaDB0a1",
  relayer: "0x000000000000000000000000000000000000bEEF",
};

const big = (_: string, v: unknown) => (typeof v === "bigint" ? toHex32(v) : v);

async function main() {
  const artifacts = loadArtifacts();
  const prover = new Prover(artifacts, { threads: 8 });
  const a = deriveKeys(("0x" + "aa".repeat(65)) as `0x${string}`);
  const b = deriveKeys(("0x" + "bb".repeat(65)) as `0x${string}`);
  const src = new MemorySource();
  const alice = await Wallet.open({ keys: a, source: src });
  const bob = await Wallet.open({ keys: b, source: src });

  // deposits planned by the wallet (deterministic blindings), delivered like the bridge would
  const plan1 = await alice.planDeposit(100n * USDC);
  const plan2 = await alice.planDeposit(1_000n * USDC);
  const deposits = [...plan1.pieces, ...plan2.pieces].map((p) => ({ denomination: p.denomination, amount: netOf(p.denomination), precommit: p.precommit }));
  for (const d of deposits) src.deposit(d.amount, d.denomination, d.precommit);
  await alice.sync();
  console.log("alice balance", alice.balance());

  // transfer 50 USDC to bob
  const t = await alice.prepareTransfer({ to: b.address, amount: 50n * USDC, ctx, prover });
  console.log(`transfer proof ${t.proof.proofBytes} B in ${t.proof.provingMs} ms`);
  src.notes(
    t.args.commitments.map((c, i) => ({ commitment: c, viewTag: t.args.notes[i].viewTag, ciphertext: t.args.notes[i].ciphertext })),
    t.args.nullifiers,
  );
  await alice.sync();
  await bob.sync();
  console.log("bob received", bob.balance(), "alice", alice.balance());
  if (bob.balance() !== 50n * USDC) throw new Error("bob did not receive");

  // split 900 = 9×100
  const s = await alice.prepareSplit({ gross: 900n * USDC, ctx, prover });
  console.log(`split proof ${s.proof.proofBytes} B in ${s.proof.provingMs} ms`);
  const filled = s.args.denomCommitments.map((c, i) => ({ c, i })).filter((x) => x.c !== 0n);
  src.notes(
    [...filled.map((x) => ({ commitment: x.c, viewTag: s.args.notes[x.i].viewTag, ciphertext: s.args.notes[x.i].ciphertext })),
      { commitment: s.args.changeCommitment, viewTag: s.args.notes[12].viewTag, ciphertext: s.args.notes[12].ciphertext }],
    s.args.nullifiers,
  );
  await alice.sync();
  const pieces = alice.withdrawablePieces();
  console.log("withdrawable pieces", pieces.length);

  // withdraw one piece
  const [w] = await alice.prepareWithdrawals({ pieces: [pieces[0]], batches: [0], ctx, prover, recipients: ["0x0000000000000000000000000000000000C0FFEE"] });
  console.log(`withdraw proof ${w.proof.proofBytes} B in ${w.proof.provingMs} ms`);
  const ok = await prover.verify("withdraw", w.proof.proof, w.proof.publicInputs);
  console.log("withdraw verifies off-chain:", ok);
  // a second piece to another L1 (SPEC §14): the destination is bound through ext_data_hash
  const echo = { blockchainId: `0x${"ec40".padStart(64, "0")}` as const, tokenRemote: "0x0000000000000000000000000000000000000ec0" as const, name: "Echo" };
  const [wl] = await alice.prepareWithdrawals({ pieces: [pieces[1]], batches: [0], ctx, prover, recipients: ["0x0000000000000000000000000000000000C0FFEE"], destination: echo });
  console.log("withdraw-to-L1 verifies off-chain:", await prover.verify("withdraw", wl.proof.proof, wl.proof.publicInputs));

  mkdirSync(OUT, { recursive: true });
  const fx = {
    vkTransfer: artifacts.meta!.transfer!.vkHash,
    vkSplit: artifacts.meta!.split!.vkHash,
    vkWithdraw: artifacts.meta!.withdraw!.vkHash,
    chainId: ctx.chainId,
    pool: ctx.pool,
    relayer: ctx.relayer,
    depositAmounts: deposits.map((d) => d.amount),
    depositPrecommits: deposits.map((d) => d.precommit),
    transferProof: t.proof.proof,
    transfer: t.args,
    transferPublicInputs: t.proof.publicInputs,
    splitProof: s.proof.proof,
    split: s.args,
    withdrawProof: w.proof.proof,
    withdraw: w.args,
    withdrawL1Proof: wl.proof.proof,
    withdrawL1: wl.args,
  };
  writeFileSync(join(OUT, "flow.json"), JSON.stringify(fx, big, 2));
  console.log("wrote", join(OUT, "flow.json"));
  await prover.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
