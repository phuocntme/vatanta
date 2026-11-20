/**
 * SIMULATED TRAFFIC (testnet/local only). Fake users deposit fixed pieces, send privately to
 * each other and withdraw at random batches, so the privacy meter and the Verify page have a
 * crowd to show. Everything goes through the real relayer with real proofs. The Verify page
 * labels its figures "include simulated traffic".
 *
 *   npx tsx src/simulate.ts [users=6] [rounds=3]
 *   env: RELAYER_URL, INDEXER_URL, NETWORK (deployment name)
 *   USDC: the relayer's faucet (MockUSDC, local) or, on Fuji, SIM_FUNDER_PK: a key holding real test
 *   USDC (https://faucet.circle.com) that pays each simulated deposit address. SIM_AMOUNTS
 *   (comma-separated USDC, default 20 with a funder) keeps Fuji runs cheap.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ChainSource, IndexerSource, KEY_MESSAGE, RelayerClient, Wallet, deriveKeys, erc20Abi, formatUsdc, pickBatches, signDeposit, USDC, SEND_FEE,
  type Context, type PreparedTx,
} from "@vatanta/sdk";
import { Prover } from "@vatanta/sdk/prover";
import { loadArtifacts } from "../../sdk/src/node/artifacts.js";
import { clients, loadDeployment, log, ROOT, waitFor } from "./env.js";
import { tokenDomain } from "./common.js";

const RELAYER = process.env.RELAYER_URL ?? "http://127.0.0.1:8080";
const INDEXER = process.env.INDEXER_URL ?? "http://127.0.0.1:8081";
const USERS = Number(process.argv[2] ?? 6);
const ROUNDS = Number(process.argv[3] ?? 3);
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const FUNDER_PK = process.env.SIM_FUNDER_PK as `0x${string}` | undefined;
const AMOUNTS = (process.env.SIM_AMOUNTS ?? (FUNDER_PK ? "20" : "30,50,120,240,1000,1110,2050")).split(",").map((x) => BigInt(x.trim()) * USDC);

async function main() {
  const d = loadDeployment();
  const { c, l1, cw, account: funder } = clients(d, FUNDER_PK ?? generatePrivateKey());
  if (FUNDER_PK) {
    const have = await c.readContract({ address: d.usdc, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] });
    log(`[simulated] funder ${funder.address} holds ${formatUsdc(have)} USDC`);
  }
  const relayer = new RelayerClient(RELAYER);
  const info = await relayer.info();
  const ctx: Context = { relayer: info.relayer, chainId: info.chainId, pool: info.pool };
  const prover = new Prover(loadArtifacts(), { threads: 8 });
  const chain = new ChainSource(l1 as never, d.shieldedPool, d.l1StartBlock);
  // simulated users' keys persist in .run/ (gitignored) so later runs keep spending their notes
  const keyFile = join(ROOT, ".run", `sim-users-${process.env.NETWORK ?? "local"}.json`);
  const saved: Hex[] = existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, "utf8")) : [];
  while (saved.length < USERS) saved.push(generatePrivateKey());
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, JSON.stringify(saved, null, 2), { mode: 0o600 });
  const users: Wallet[] = [];
  for (let i = 0; i < USERS; i++) {
    const u = privateKeyToAccount(saved[i]);
    const w = await Wallet.open({ keys: deriveKeys(await u.signMessage({ message: KEY_MESSAGE })), source: new IndexerSource(INDEXER, chain) });
    await w.sync();
    users.push(w);
  }
  log(`[simulated] ${USERS} users, ${ROUNDS} rounds`);

  // deposits (only for users without a private balance yet)
  for (const [i, w] of users.entries()) {
    if (w.balance() > 0n) {
      log(`[simulated] user ${i} already holds ${formatUsdc(w.balance())} private`);
      continue;
    }
    const gross = pick(AMOUNTS);
    const plan = await w.planDeposit(gross);
    const signed = await signDeposit({
      account: plan.account!,
      router: d.depositRouter,
      chainId: d.cChainId,
      token: await tokenDomain(c as never, d.usdc, d.cChainId),
      permitNonce: await c.readContract({ address: d.usdc, abi: parseAbi(["function nonces(address) view returns (uint256)"]), functionName: "nonces", args: [plan.owner] }),
      gross,
      pieces: plan.pieces,
      feeRecipient: info.relayer,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    });
    await relayer.registerDeposit(signed);
    if (FUNDER_PK) {
      // real USDC (Fuji): the funder plays "the exchange" paying the one-time deposit address
      await c.waitForTransactionReceipt({ hash: await cw.writeContract({ address: d.usdc, abi: erc20Abi, functionName: "transfer", args: [plan.owner, gross] }) });
    } else {
      const f = await fetch(`${RELAYER}/v1/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: plan.owner, amount: gross.toString() }) });
      if (!f.ok) throw new Error(`faucet: ${await f.text()} (start the relayer with FAUCET=1, or set SIM_FUNDER_PK)`);
    }
    log(`[simulated] user ${i} deposits ${formatUsdc(gross)} in ${plan.pieces.length} pieces`);
  }
  for (const w of users) await waitFor("simulated deposits", async () => (await w.sync(), w.balance() > 0n), 120_000, 2_000);

  for (let r = 0; r < ROUNDS; r++) {
    for (const [i, w] of users.entries()) {
      await w.sync();
      const bal = w.balance();
      if (bal < 2n * USDC) continue;
      // a withdrawal needs at least one 10 USDC piece plus the split fee
      const maxPieces = (bal - SEND_FEE) / (10n * USDC);
      const action = maxPieces > 0n ? Math.random() : 0;
      try {
        if (action < 0.6) {
          const to = pick(users.filter((x) => x !== w));
          const amt = (bal / 5n / USDC) * USDC + BigInt(Math.floor(Math.random() * 100)) * 10_000n;
          if (w.mergesNeeded(amt + SEND_FEE) !== 0) continue;
          const t = await w.prepareTransfer({ to: to.address, amount: amt, ctx, prover });
          await w.markSubmitted(t as PreparedTx<unknown>, (await relayer.transfer(t.proof.proof, t.args)).txHash);
          log(`[simulated] round ${r}: user ${i} sends privately`);
        } else {
          const gross = 10n * USDC * BigInt(1 + Math.floor(Math.random() * Math.min(3, Number(maxPieces))));
          if (w.mergesNeeded(gross + SEND_FEE) !== 0) continue;
          const s = await w.prepareSplit({ gross, ctx, prover });
          await w.markSubmitted(s as PreparedTx<unknown>, (await relayer.split(s.proof.proof, s.args)).txHash);
          await waitFor("pieces", async () => (await w.sync(), w.withdrawablePieces().length >= s.pieces.length), 60_000);
          const pieces = w.withdrawablePieces();
          const batches = pickBatches(pieces.length, "standard", Math.floor(Date.now() / 1000), info.batchIntervalSecs, Math.min(6 * 3600, 6 * info.batchIntervalSecs));
          const ws = await w.prepareWithdrawals({ pieces, batches, ctx, prover });
          await relayer.schedule(ws.map((x) => ({ batch: x.batch, proof: x.proof.proof, args: x.args })));
          log(`[simulated] round ${r}: user ${i} schedules ${ws.length} withdrawal piece(s)`);
        }
      } catch (e) {
        log(`[simulated] user ${i} skipped: ${(e as Error).message}`);
      }
    }
  }
  await prover.destroy();
  log("[simulated] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export type { Hex };
