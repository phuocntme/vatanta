import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";
import { ROOT, log, waitFor } from "./env.js";

export function sh(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, env: { ...process.env, ...opts.env }, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

export function ensureDb(name: string) {
  spawnSync("createdb", [name], { stdio: "ignore" });
}

export interface Services {
  stop(): void;
}

async function portBusy(port: number) {
  return (await fetch(`http://127.0.0.1:${port}/health`).catch(() => null)) !== null;
}

/**
 * Starts relayer + indexer from the debug build. `reset` wipes both databases (right after a fresh
 * deploy); without it queued withdrawals, pending deposits and the indexed tree survive a restart.
 */
export async function startServices(env: Record<string, string>, opts: { reset?: boolean } = {}): Promise<Services> {
  const reset = opts.reset ?? true;
  for (const p of [8080, 8081]) {
    if (await portBusy(p)) throw new Error(`port ${p} is already in use — stop the running relayer/indexer first (pkill -f target/debug/vatanta-)`);
  }
  const svc = join(ROOT, "services");
  sh("cargo", ["build", "--quiet"], { cwd: svc });
  const procs: ChildProcess[] = [];
  const start = (name: string, extra: Record<string, string>) => {
    const out = openSync(join(ROOT, ".run", `${name}.log`), "w");
    const p = spawn(join(svc, "target", "debug", `vatanta-${name}`), [], { cwd: svc, env: { ...process.env, ...env, ...extra }, stdio: ["ignore", out, out] });
    procs.push(p);
    return p;
  };
  start("indexer", { DATABASE_URL: env.INDEXER_DATABASE_URL, INDEXER_RESET: reset ? "1" : "0", BIND: "127.0.0.1:8081" });
  start("relayer", { DATABASE_URL: env.RELAYER_DATABASE_URL, RELAYER_RESET: reset ? "1" : "0", BIND: "127.0.0.1:8080" });
  await waitFor("relayer", async () => (await fetch("http://127.0.0.1:8080/health").catch(() => null))?.ok, 30_000, 500);
  await waitFor("indexer", async () => (await fetch("http://127.0.0.1:8081/health").catch(() => null))?.ok, 30_000, 500);
  log("relayer :8080 and indexer :8081 up (logs in .run/)");
  return { stop: () => procs.forEach((p) => p.kill("SIGTERM")) };
}
