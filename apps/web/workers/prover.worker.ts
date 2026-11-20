/// <reference lib="webworker" />
// Proving runs here, off the main thread. Witnesses and secrets never leave this browser.
import * as Comlink from "comlink";
import { Prover, type CircuitName } from "@vatanta/sdk/prover";
import type { Artifacts } from "@vatanta/sdk";

let prover: Prover | null = null;

async function load(): Promise<Prover> {
  if (prover) return prover;
  const names: CircuitName[] = ["transfer", "split", "withdraw"];
  const get = (f: string) => fetch(`/circuits/${f}`).then((r) => r.json());
  const circuits = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await get(`${n}.json`)])));
  const meta = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await get(`${n}.meta.json`)])));
  const threads = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
  prover = new Prover({ circuits, meta } as Artifacts, { threads });
  return prover;
}

const api = {
  async warmup() {
    await (await load()).warmup();
    return true;
  },
  async prove(name: CircuitName, inputs: Record<string, unknown>) {
    return (await load()).prove(name, inputs);
  },
  async verify(name: CircuitName, proof: `0x${string}`, publicInputs: string[]) {
    return (await load()).verify(name, proof, publicInputs);
  },
};

export type ProverWorker = typeof api;
Comlink.expose(api);
