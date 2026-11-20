/**
 * Fuji smoke test against the running stack (scripts/fuji-local.sh up): real Circle USDC, real
 * proofs, the Docker relayer / indexer / icm-relayer and the live L1.
 *
 *   deposit 20 USDC (one-time address paid by the funder) → private send 5 USDC to a second
 *   account → split 10 → withdraw it in the next batch → USDC arrives at a fresh C-Chain address
 *
 *   NETWORK=fuji npx tsx src/fuji-smoke.ts        (from e2e/; reads ../.env)
 *   env: FUNDER_PK (default DEPLOYER_PK from .env) must hold ≥ 20 test USDC (https://faucet.circle.com)
 *        RELAYER_URL / INDEXER_URL (default the Docker ports 8090 / 8091)
 *        Alice's and Bob's keys are kept in .run/smoke-users-<network>.json (gitignored): a rerun
 *          reuses Alice's private balance and skips the deposit when it already covers the run.
 *        SMOKE_DEST=<name> withdraws the piece to that L1 instead of C-Chain (SPEC §14): a name from
 *          "destinations" or "testDestinations" in the deployment file
 *
 * The withdrawal waits for the relayer's next batch (≤ 10 min on Fuji) and the ICM return trip.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ChainSource, IndexerSource, KEY_MESSAGE, RelayerClient, SEND_FEE, Wallet, deriveKeys, erc20Abi, formatUsdc, pickBatches, signDeposit, USDC,
  type Context,
  type WithdrawDestination,
} from "@vatanta/sdk";
import { Prover } from "@vatanta/sdk/prover";
import { loadArtifacts } from "../../sdk/src/node/artifacts.js";
import { clients, loadDeployment, loadEnvFile, log, ROOT, waitFor } from "./env.js";
import { tokenDomain } from "./common.js";

const RELAYER = process.env.RELAYER_URL ?? "http://127.0.0.1:8090";
const INDEXER = process.env.INDEXER_URL ?? "http://127.0.0.1:8091";
interface DestEntry { name: string; rpc: string; blockchainId: Hex; tokenRemote: Address; chainId: number }

async function main() {
  const env = loadEnvFile(join(ROOT, ".env"));
  const d = loadDeployment(process.env.NETWORK ?? "fuji");
  const all = [...((d as unknown as { destinations?: DestEntry[] }).destinations ?? []), ...((d as unknown as { testDestinations?: DestEntry[] }).testDestinations ?? [])];
  const destEntry = process.env.SMOKE_DEST ? all.find((x) => x.name === process.env.SMOKE_DEST) : undefined;
  if (process.env.SMOKE_DEST && !destEntry) throw new Error(`SMOKE_DEST ${process.env.SMOKE_DEST} not in the deployment file (have: ${all.map((x) => x.name).join(", ") || "none"})`);
  const GROSS = 20n * USDC;
  const { c, cw, l1, account: funder } = clients(d, (process.env.FUNDER_PK ?? env.DEPLOYER_PK) as Hex);
  const bal = (a: Address) => c.readContract({ address: d.usdc, abi: erc20Abi, functionName: "balanceOf", args: [a] });
  const have = await bal(funder.address);

  const relayer = new RelayerClient(RELAYER);
  const info = await relayer.info();
  const ctx: Context = { relayer: info.relayer, chainId: info.chainId, pool: info.pool };
  const prover = new Prover(loadArtifacts(), { threads: 8 });
  const chain = new ChainSource(l1 as never, d.shieldedPool, d.l1StartBlock);
  // test users' keys survive a failed run, so their private balance is not stranded
  const keyFile = join(ROOT, ".run", `smoke-users-${d.network}.json`);
  const saved: { alice?: Hex; bob?: Hex } = existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, "utf8")) : {};
  const keys = { alice: saved.alice ?? generatePrivateKey(), bob: saved.bob ?? generatePrivateKey() };
  writeFileSync(keyFile, JSON.stringify(keys), { mode: 0o600 });
  const mk = async (pk: Hex) => {
    const user = privateKeyToAccount(pk);
    return Wallet.open({ keys: deriveKeys(await user.signMessage({ message: KEY_MESSAGE })), source: new IndexerSource(INDEXER, chain) });
  };
  const alice = await mk(keys.alice);
  const bob = await mk(keys.bob);
  await alice.sync();
  await bob.sync();
  const t0 = Date.now();
  const secs = () => `${Math.round((Date.now() - t0) / 1000)} s`;
  const nPieces = 1;
  // what steps 2–3 spend: 5 to bob + 0.10 send fee, the pieces + 0.10 split fee
  const need = 5n * USDC + SEND_FEE + BigInt(nPieces) * 10n * USDC + SEND_FEE;
  const reuse = alice.balance() >= need;
  if (!reuse && have < GROSS) throw new Error(`funder ${funder.address} holds ${formatUsdc(have)} USDC; send it ≥ ${formatUsdc(GROSS)} from https://faucet.circle.com (Avalanche Fuji)`);

  if (reuse) log(`1/4 skip deposit: alice already holds ${formatUsdc(alice.balance())} USDC privately (saved keys)`);
  else {
  log(`1/4 deposit ${formatUsdc(GROSS)} USDC through a one-time address (funder ${funder.address} plays the exchange)`);
  const plan = await alice.planDeposit(GROSS);
  await relayer.registerDeposit(
    await signDeposit({
      account: plan.account!,
      router: d.depositRouter,
      chainId: d.cChainId,
      token: await tokenDomain(c as never, d.usdc, d.cChainId),
      permitNonce: await c.readContract({ address: d.usdc, abi: parseAbi(["function nonces(address) view returns (uint256)"]), functionName: "nonces", args: [plan.owner] }),
      gross: GROSS,
      pieces: plan.pieces,
      feeRecipient: info.relayer,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    }),
  );
  await c.waitForTransactionReceipt({ hash: await cw.writeContract({ address: d.usdc, abi: erc20Abi, functionName: "transfer", args: [plan.owner, GROSS] }) });
  await waitFor("relayer to deposit", async () => (await relayer.depositStatus(plan.owner))?.status === "done", 180_000, 3_000);
  await waitFor("deposit notes over ICM", async () => (await alice.sync(), alice.balance() > 0n), 300_000, 3_000);
  if (!alice.rootOk) throw new Error("indexer root not accepted on-chain");
  log(`   alice private balance ${formatUsdc(alice.balance())} USDC (${secs()})`);
  }

  log("2/4 private send 5 USDC → bob");
  const t = await alice.prepareTransfer({ to: bob.address, amount: 5n * USDC, ctx, prover });
  const tr = await relayer.transfer(t.proof.proof, t.args);
  await alice.markSubmitted(t, tr.txHash);
  log(`   proof ${t.proof.provingMs} ms / ${t.proof.proofBytes} B, tx ${tr.txHash}`);
  const bobBefore = bob.balance();
  await waitFor("bob receives", async () => (await bob.sync(), bob.balance() === bobBefore + 5n * USDC), 120_000, 2_000);
  log(`   bob found the note by view tag: +5.00 USDC, now ${formatUsdc(bob.balance())} (${secs()})`);

  log(`3/4 split ${nPieces * 10} → ${nPieces} withdrawable piece(s), scheduled for the next batch${destEntry ? ` (to ${destEntry.name})` : ""}`);
  // the send's change note must be back before two notes can cover the split
  await waitFor("alice's change note", async () => (await alice.sync(), alice.mergesNeeded(BigInt(nPieces) * 10n * USDC + SEND_FEE) === 0), 120_000, 2_000);
  const before = new Set(alice.withdrawablePieces().map((p) => p.nullifier.toString()));
  const s = await alice.prepareSplit({ gross: BigInt(nPieces) * 10n * USDC, ctx, prover });
  await alice.markSubmitted(s, (await relayer.split(s.proof.proof, s.args)).txHash);
  const fresh = () => alice.withdrawablePieces().filter((p) => !before.has(p.nullifier.toString()));
  await waitFor("split pieces", async () => (await alice.sync(), fresh().length === nPieces), 120_000, 2_000);
  const pieces = fresh();
  const now = Math.floor(Date.now() / 1000);
  const batches = pickBatches(pieces.length, "fast", now, info.batchIntervalSecs);
  const dest: WithdrawDestination | null = destEntry ? { name: destEntry.name, blockchainId: destEntry.blockchainId, tokenRemote: destEntry.tokenRemote } : null;
  const prepared = await alice.prepareWithdrawals({ pieces, batches, ctx, prover, destination: dest });
  const toC = dest ? [] : prepared;
  const toL1 = dest ? prepared : [];
  await relayer.schedule([...toC, ...toL1].map((w) => ({ batch: w.batch, proof: w.proof.proof, args: w.args })));
  log(`   scheduled for the batch in ${batches[0] - now} s`);

  log(`4/4 wait for the batch and the ICM trip to C-Chain${dest ? ` and on to ${dest.name}` : ""}`);
  const wait = (batches[0] - now + 300) * 1000;
  const check = async (label: string, w: (typeof toC)[number], read: (a: Address) => Promise<bigint>) => {
    const got = await waitFor(`USDC at ${w.args.recipient} on ${label}`, async () => ((await read(w.args.recipient)) > 0n ? read(w.args.recipient) : undefined), wait, 5_000);
    const expected = w.args.amount - (w.args.amount * 25n) / 10_000n;
    log(`   ${w.args.recipient} received ${formatUsdc(got)} USDC on ${label} (${secs()})`);
    if (got !== expected) throw new Error(`expected ${expected}, got ${got}`);
  };
  for (const w of toC) await check("C-Chain", w, bal);
  if (destEntry) {
    const dc = createPublicClient({ transport: http(destEntry.rpc) });
    const destBal = (a: Address) => dc.readContract({ address: destEntry.tokenRemote, abi: erc20Abi, functionName: "balanceOf", args: [a] });
    for (const w of toL1) await check(destEntry.name, w, destBal);
  }
  await alice.sync();
  log(`   alice ${formatUsdc(alice.balance())}, bob ${formatUsdc(bob.balance())} USDC private`);
  await prover.destroy();
  log(`FUJI SMOKE PASSED: deposit → private send → split → withdraw${destEntry ? ` to ${destEntry.name} (multi-hop via C-Chain)` : ""}, real USDC, real proofs, live L1 + ICM`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
