/**
 * An autonomous agent paying for an API call through the relayer's agent API.
 *
 *  1. POST /send without a proof            → HTTP 402 + payment requirements (fee, payTo, pool, chain)
 *  2. agent builds a zero-knowledge transfer whose public fee pays `payTo`, recipient = the API seller
 *  3. POST /send again with { proof, args } → 200 + L1 tx hash
 *  4. the seller's wallet finds the private note; nobody else learns who paid whom or how much
 *
 * The in-proof fee is the source of truth; the 402 body only describes it.
 * Run against the local network with relayer (FAUCET=1) + indexer up:  pnpm --filter @vatanta/agent-demo start
 */
import { parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ChainSource, IndexerSource, KEY_MESSAGE, Wallet, deriveKeys, formatUsdc, signDeposit, USDC, type PreparedTx } from "@vatanta/sdk";
import { Prover } from "@vatanta/sdk/prover";
import { loadArtifacts } from "../../../sdk/src/node/artifacts.js";
import { clients, loadDeployment, log, waitFor } from "../../../e2e/src/env.js";
import { tokenDomain } from "../../../e2e/src/common.js";

const RELAYER = process.env.RELAYER_URL ?? "http://127.0.0.1:8080";
const INDEXER = process.env.INDEXER_URL ?? "http://127.0.0.1:8081";
const PRICE = 500_000n; // 0.50 USDC per API call

async function newWallet(src: () => IndexerSource) {
  const u = privateKeyToAccount(generatePrivateKey());
  return Wallet.open({ keys: deriveKeys(await u.signMessage({ message: KEY_MESSAGE })), source: src() });
}

async function main() {
  const d = loadDeployment();
  const { c, l1 } = clients(d, generatePrivateKey());
  const chain = new ChainSource(l1 as never, d.shieldedPool, d.l1StartBlock);
  const src = () => new IndexerSource(INDEXER, chain);
  const seller = await newWallet(src);
  const agent = await newWallet(src);
  const prover = new Prover(loadArtifacts(), { threads: 8 });

  // fund the agent once (20 USDC deposit through a one-time address + testnet faucet)
  const info = await (await fetch(`${RELAYER}/v1/info`)).json();
  const plan = await agent.planDeposit(20n * USDC);
  const signed = await signDeposit({
    account: plan.account!,
    router: d.depositRouter,
    chainId: d.cChainId,
    token: await tokenDomain(c as never, d.usdc, d.cChainId),
    permitNonce: await c.readContract({ address: d.usdc, abi: parseAbi(["function nonces(address) view returns (uint256)"]), functionName: "nonces", args: [plan.owner] }),
    gross: 20n * USDC,
    pieces: plan.pieces,
    feeRecipient: info.relayer,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  });
  await fetch(`${RELAYER}/v1/deposit-address`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signed, (_, v) => (typeof v === "bigint" ? v.toString() : v)) });
  await fetch(`${RELAYER}/v1/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: plan.owner, amount: (20n * USDC).toString() }) });
  await waitFor("agent funded", async () => (await agent.sync(), agent.balance() > 0n), 120_000, 2_000);
  log(`agent private balance ${formatUsdc(agent.balance())} USDC`);

  for (let call = 1; call <= 3; call++) {
    // 1. ask to pay without a proof → 402
    const r402 = await fetch(`${RELAYER}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: seller.address, amount: PRICE.toString() }) });
    const req = await r402.json();
    const acc = req.accepts[0];
    log(`call ${call}: HTTP ${r402.status} → pay fee ${formatUsdc(BigInt(acc.maxAmountRequired))} to ${acc.payTo.slice(0, 10)}… on ${acc.network}`);
    // 2. prove locally, binding fee + relayer + chain + pool from the requirement
    const ctx = { relayer: acc.payTo, chainId: acc.extra.chainId, pool: acc.extra.pool };
    if (agent.mergesNeeded(PRICE + 100_000n) !== 0) {
      const m = await agent.prepareMerge({ ctx, prover });
      const mr = await post({ proof: m.proof.proof, args: m.args });
      await agent.markSubmitted(m as PreparedTx<unknown>, mr.txHash);
      await waitFor("merge", async () => (await agent.sync(), agent.mergesNeeded(PRICE + 100_000n) === 0), 60_000);
    }
    const t = await agent.prepareTransfer({ to: seller.address, amount: PRICE, ctx, prover });
    // 3. retry with the proof
    const res = await post({ proof: t.proof.proof, args: t.args });
    await agent.markSubmitted(t as PreparedTx<unknown>, res.txHash);
    log(`call ${call}: paid ${formatUsdc(PRICE)} USDC privately (proof ${t.proof.provingMs} ms), tx ${res.txHash.slice(0, 14)}…`);
    await waitFor("seller sees payment", async () => (await seller.sync(), seller.balance() >= PRICE * BigInt(call)), 60_000);
    await agent.sync();
  }
  log(`seller received ${formatUsdc(seller.balance())} USDC; on-chain only nullifiers, commitments and ciphertext are visible`);
  await prover.destroy();
}

async function post(body: unknown) {
  const r = await fetch(`${RELAYER}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) });
  const j = await r.json();
  if (!r.ok) throw new Error(`relayer ${r.status}: ${JSON.stringify(j)}`);
  return j as { txHash: `0x${string}` };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
