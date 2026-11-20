/**
 * `pnpm e2e` — full local end-to-end flow:
 * starts a local Avalanche network, deploys everything, starts relayer + indexer and runs
 * deposit → private send → split → scheduled withdraw with REAL proofs through the relayer.
 *
 *   E2E_CLEAN=1       wipe the local network first
 *   E2E_SKIP_DEPLOY=1 reuse contracts/deployments/local.json
 *   E2E_BATCH_SECS    relayer batch interval for the test (default 15; production is 600)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseAbi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ChainSource, IndexerSource, KEY_MESSAGE, RelayerClient, Wallet, deriveKeys, erc20Abi, formatUsdc, pickBatches, signDeposit, USDC,
  type Context,
} from "@vatanta/sdk";
import { Prover } from "@vatanta/sdk/prover";
import { loadArtifacts } from "../../sdk/src/node/artifacts.js";
import { clients, loadDeployment, loadEnvFile, log, ROOT, waitFor } from "./env.js";
import { tokenDomain } from "./common.js";
import { ensureDb, sh, startServices } from "./services.js";

const BATCH = Number(process.env.E2E_BATCH_SECS ?? 15);
const RELAYER = "http://127.0.0.1:8080";
const INDEXER = "http://127.0.0.1:8081";

async function main() {
  mkdirSync(join(ROOT, ".run"), { recursive: true });
  log("1/7 local Avalanche network");
  sh(join(ROOT, "l1", "local-up.sh"), []);
  const env = loadEnvFile(join(ROOT, "l1", ".local.env"));
  if (process.env.E2E_SKIP_DEPLOY !== "1") {
    log("2/7 deploy contracts (C-Chain + L1, ICTT, verifiers)");
    sh(join(ROOT, "contracts", "script", "deploy.sh"), [join(ROOT, "l1", ".local.env")]);
  }
  const d = loadDeployment("local");
  ensureDb("vatanta_indexer");
  ensureDb("vatanta_relayer");
  log("3/7 relayer + indexer");
  const services = await startServices({
    DEPLOYMENT: join(ROOT, "contracts", "deployments", "local.json"),
    RELAYER_PK: env.DEPLOYER_PK,
    BATCH_INTERVAL_SECS: String(BATCH),
    DEPOSIT_POLL_SECS: "2",
    INDEXER_DATABASE_URL: process.env.INDEXER_DATABASE_URL ?? "postgres://localhost/vatanta_indexer",
    RELAYER_DATABASE_URL: process.env.RELAYER_DATABASE_URL ?? "postgres://localhost/vatanta_relayer",
    POLL_MS: "500",
  });
  try {
    await flow(d, env);
  } finally {
    services.stop();
  }
}

async function flow(d: ReturnType<typeof loadDeployment>, env: Record<string, string>) {
  const { c, cw, l1 } = clients(d, env.DEPLOYER_PK as Hex);
  const relayer = new RelayerClient(RELAYER);
  const info = await relayer.info();
  const ctx: Context = { relayer: info.relayer, chainId: info.chainId, pool: info.pool };
  const prover = new Prover(loadArtifacts(), { threads: 8 });
  const chain = new ChainSource(l1 as never, d.shieldedPool, d.l1StartBlock);
  const mk = async () => {
    const user = privateKeyToAccount(generatePrivateKey());
    return Wallet.open({ keys: deriveKeys(await user.signMessage({ message: KEY_MESSAGE })), source: new IndexerSource(INDEXER, chain) });
  };
  const alice = await mk();
  const bob = await mk();

  // ---------------------------------------------------------------- deposit via one-time address
  log("4/7 deposit 2,350 USDC through a one-time address (relayer pays gas)");
  const gross = 2_350n * USDC;
  const plan = await alice.planDeposit(gross);
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
  // "exchange withdrawal" to the one-time address (MockUSDC faucet on local)
  await c.waitForTransactionReceipt({ hash: await cw.writeContract({ address: d.usdc, abi: erc20Abi, functionName: "mint", args: [plan.owner, gross] }) });
  await waitFor("relayer to deposit", async () => (await relayer.depositStatus(plan.owner))?.status === "done", 60_000);
  await waitFor("deposit notes", async () => (await alice.sync(), alice.balance() === 2_344_125_000n), 120_000, 1_000);
  if (!alice.rootOk) throw new Error("indexer root not accepted on-chain");
  log(`   alice private balance ${formatUsdc(alice.balance())} (root checked on-chain)`);

  // ---------------------------------------------------------------- private send
  log("5/7 private send 250 → bob via relayer");
  const t = await alice.prepareTransfer({ to: bob.address, amount: 250n * USDC, ctx, prover });
  const tr = await relayer.transfer(t.proof.proof, t.args);
  await alice.markSubmitted(t, tr.txHash);
  log(`   proof ${t.proof.provingMs} ms / ${t.proof.proofBytes} B, tx ${tr.txHash.slice(0, 12)}…`);
  await waitFor("bob receives", async () => (await bob.sync(), bob.balance() === 250n * USDC), 60_000);
  log(`   bob found the note by view tag: ${formatUsdc(bob.balance())}`);

  // ---------------------------------------------------------------- split + scheduled withdraw
  log("6/7 split 1,100 → [1,000, 100] and schedule both pieces at random client-chosen batches");
  await alice.sync();
  const s = await alice.prepareSplit({ gross: 1_100n * USDC, ctx, prover });
  await alice.markSubmitted(s, (await relayer.split(s.proof.proof, s.args)).txHash);
  await waitFor("split pieces", async () => (await alice.sync(), alice.withdrawablePieces().length === 2), 60_000);
  const pieces = alice.withdrawablePieces();
  const now = Math.floor(Date.now() / 1000);
  const batches = pickBatches(pieces.length, "standard", now, info.batchIntervalSecs, 3 * info.batchIntervalSecs);
  const ws = await alice.prepareWithdrawals({ pieces, batches, ctx, prover });
  await relayer.schedule(ws.map((w) => ({ batch: w.batch, proof: w.proof.proof, args: w.args })));
  log(`   scheduled for batches ${batches.map((b) => `+${b - now}s`).join(", ")}`);

  log("7/7 wait for the batches to run and USDC to arrive at fresh C-Chain addresses");
  const bal = (a: Address) => c.readContract({ address: d.usdc, abi: erc20Abi, functionName: "balanceOf", args: [a] });
  for (const w of ws) {
    const got = await waitFor(`USDC at ${w.args.recipient}`, async () => ((await bal(w.args.recipient)) > 0n ? bal(w.args.recipient) : undefined), 5 * 60_000, 2_000);
    log(`   ${w.args.recipient} received ${formatUsdc(got)} USDC`);
    const expected = w.args.amount - (w.args.amount * 25n) / 10_000n;
    if (got !== expected) throw new Error(`expected ${expected}, got ${got}`);
  }
  await alice.sync();
  const stats = await (await fetch(`${INDEXER}/v1/stats`)).json();
  log(`   indexer: ${stats.notes} notes, ${stats.privateTxs} private txs, bridge holds ${formatUsdc(BigInt(stats.bridgeUsdc))} USDC`);
  log(`   alice private balance ${formatUsdc(alice.balance())}, bob ${formatUsdc(bob.balance())}`);
  await prover.destroy();
  log("E2E PASSED: deposit → private send → split → scheduled withdraw, real proofs, local Avalanche L1 + ICTT");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
