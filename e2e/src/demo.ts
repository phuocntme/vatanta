/**
 * `pnpm demo` — local demo stack in one command: network (reused), contracts (deployed if
 * missing or stale; DEMO_REDEPLOY=1 forces), relayer (faucet on, 60 s batches), indexer, web app.
 * Relayer/indexer data is kept across restarts unless contracts were redeployed (DEMO_RESET=1 forces).
 * Open http://localhost:4001 and click "Use a demo account". Ctrl-C stops everything.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createPublicClient, http, type Address } from "viem";
import { loadEnvFile, log, ROOT } from "./env.js";
import { ensureDb, sh, startServices } from "./services.js";

async function poolExists(depPath: string): Promise<boolean> {
  const d = JSON.parse(readFileSync(depPath, "utf8")) as { l1Rpc: string; shieldedPool: Address };
  const code = await createPublicClient({ transport: http(d.l1Rpc) }).getCode({ address: d.shieldedPool }).catch(() => undefined);
  return !!code && code !== "0x";
}

async function main() {
  mkdirSync(join(ROOT, ".run"), { recursive: true });
  sh(join(ROOT, "l1", "local-up.sh"), []);
  const env = loadEnvFile(join(ROOT, "l1", ".local.env"));
  const dep = join(ROOT, "contracts", "deployments", "local.json");
  // local.json survives `E2E_CLEAN=1` / a wiped network, so make sure its pool still exists
  let redeploy = !existsSync(dep) || process.env.DEMO_REDEPLOY === "1";
  if (!redeploy && !(await poolExists(dep))) {
    log("contracts/deployments/local.json points to contracts that are not on this network → redeploying");
    redeploy = true;
  }
  if (redeploy) sh(join(ROOT, "contracts", "script", "deploy.sh"), [join(ROOT, "l1", ".local.env")]);
  ensureDb("vatanta_indexer");
  ensureDb("vatanta_relayer");
  const services = await startServices({
    DEPLOYMENT: dep,
    RELAYER_PK: env.DEPLOYER_PK,
    BATCH_INTERVAL_SECS: process.env.DEMO_BATCH_SECS ?? "60",
    FAUCET: "1",
    INDEXER_DATABASE_URL: process.env.INDEXER_DATABASE_URL ?? "postgres://localhost/vatanta_indexer",
    RELAYER_DATABASE_URL: process.env.RELAYER_DATABASE_URL ?? "postgres://localhost/vatanta_relayer",
  }, { reset: redeploy || process.env.DEMO_RESET === "1" });
  sh("pnpm", ["--filter", "@vatanta/web", "build"]);
  const web = spawn("pnpm", ["--filter", "@vatanta/web", "start"], { cwd: ROOT, stdio: "inherit" });
  log("demo running → http://localhost:4001   (relayer :8080, indexer :8081; Ctrl-C to stop)");
  const stop = () => {
    services.stop();
    web.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
