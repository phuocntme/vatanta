/**
 * Build-order step 2: one full deposit → private transfer → split → withdraw on the local
 * network, submitted directly by a script (no relayer service) with REAL proofs.
 */
import { join } from "node:path";
import { parseAbi, type Hex } from "viem";
import {
  ChainSource, Wallet, deriveKeys, depositRouterAbi, erc20Abi, shieldedPoolAbi, signDeposit, formatUsdc, USDC,
  KEY_MESSAGE, type Context,
} from "@vatanta/sdk";
import { Prover } from "@vatanta/sdk/prover";
import { loadArtifacts } from "../../sdk/src/node/artifacts.js";
import { clients, loadDeployment, loadEnvFile, log, ROOT, waitFor } from "./env.js";
import { tokenDomain } from "./common.js";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const d = loadDeployment();
const env = loadEnvFile(join(ROOT, "l1", ".local.env"));
const { account, c, l1, cw, l1w } = clients(d, env.DEPLOYER_PK as Hex);
const ctx: Context = { relayer: account.address, chainId: d.l1ChainId, pool: d.shieldedPool };

async function userKeys() {
  // a user wallet signs the fixed message once; keys are derived client-side
  const u = privateKeyToAccount(generatePrivateKey());
  return deriveKeys(await u.signMessage({ message: KEY_MESSAGE }));
}

async function main() {
  const prover = new Prover(loadArtifacts(), { threads: 8 });
  const source = () => new ChainSource(l1 as never, d.shieldedPool, Math.max(0, d.l1StartBlock - 100));
  const alice = await Wallet.open({ keys: await userKeys(), source: source() });
  const bob = await Wallet.open({ keys: await userKeys(), source: source() });
  log("alice", alice.address.slice(0, 20) + "…", "bob", bob.address.slice(0, 20) + "…");

  // ---- deposit 2,350 USDC from a one-time address (funded as if from an exchange)
  const gross = 2_350n * USDC;
  const plan = await alice.planDeposit(gross);
  log("one-time deposit address", plan.owner, "pieces", plan.pieces.length);
  await cw.writeContract({ address: d.usdc, abi: erc20Abi, functionName: "mint", args: [plan.owner, gross] }).then((h) => c.waitForTransactionReceipt({ hash: h }));
  const signed = await signDeposit({
    account: plan.account!,
    router: d.depositRouter,
    chainId: d.cChainId,
    token: await tokenDomain(c as never, d.usdc, d.cChainId),
    permitNonce: await c.readContract({ address: d.usdc, abi: parseAbi(["function nonces(address) view returns (uint256)"]), functionName: "nonces", args: [plan.owner] }),
    gross,
    pieces: plan.pieces,
    feeRecipient: account.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  });
  const depTx = await cw.writeContract({ address: d.depositRouter, abi: depositRouterAbi, functionName: "deposit", args: [signed.intent, signed.permitSig, signed.intentSig], gas: 8_000_000n });
  const rc = await c.waitForTransactionReceipt({ hash: depTx });
  log("DepositRouter.deposit", rc.status, "gas", rc.gasUsed);
  await waitFor("10 deposit pieces in the pool", async () => (await alice.sync(), alice.balance() === 2_344_125_000n), 180_000, 2_000);
  log("alice private balance", formatUsdc(alice.balance()));

  // ---- private transfer 250 → bob (self-submitted)
  const t = await alice.prepareTransfer({ to: bob.address, amount: 250n * USDC, ctx, prover });
  log(`transfer proof: ${t.proof.provingMs} ms, ${t.proof.proofBytes} B`);
  const tTx = await l1w.writeContract({ address: d.shieldedPool, abi: shieldedPoolAbi, functionName: "transfer", args: [t.proof.proof, t.args], gas: 8_000_000n });
  const tr = await l1.waitForTransactionReceipt({ hash: tTx });
  log("pool.transfer", tr.status, "gas", tr.gasUsed);
  await alice.markSubmitted(t, tTx);
  await waitFor("bob sees 250", async () => (await bob.sync(), bob.balance() === 250n * USDC));
  await alice.sync();
  log("bob balance", formatUsdc(bob.balance()), "alice", formatUsdc(alice.balance()));

  // ---- split 1,000 into one denomination piece, then withdraw it
  const s = await alice.prepareSplit({ gross: 1_000n * USDC, ctx, prover });
  const sTx = await l1w.writeContract({ address: d.shieldedPool, abi: shieldedPoolAbi, functionName: "split", args: [s.proof.proof, s.args as never], gas: 12_000_000n });
  log("pool.split", (await l1.waitForTransactionReceipt({ hash: sTx })).status);
  await alice.markSubmitted(s, sTx);
  await waitFor("split pieces", async () => (await alice.sync(), alice.withdrawablePieces().length === 1));
  const [w] = await alice.prepareWithdrawals({ pieces: alice.withdrawablePieces(), batches: [0], ctx, prover });
  const wTx = await l1w.writeContract({ address: d.shieldedPool, abi: shieldedPoolAbi, functionName: "withdraw", args: [w.proof.proof, w.args], gas: 8_000_000n });
  log("pool.withdraw", (await l1.waitForTransactionReceipt({ hash: wTx })).status);
  const got = await waitFor("USDC on C-Chain", async () => {
    const b = await c.readContract({ address: d.usdc, abi: erc20Abi, functionName: "balanceOf", args: [w.args.recipient] });
    return b > 0n ? b : undefined;
  });
  log(`fresh exit address ${w.args.recipient} received ${formatUsdc(got)} USDC on C-Chain`);
  if (got !== 997_500_000n) throw new Error("unexpected withdraw amount");
  await alice.sync();
  log("alice final private balance", formatUsdc(alice.balance()));
  await prover.destroy();
  log("DIRECT FLOW OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
