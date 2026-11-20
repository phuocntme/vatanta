// Node-only helpers: load compiled circuits from sdk/circuits.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Artifacts, CircuitName } from "../prover/index.js";

const here = dirname(fileURLToPath(import.meta.url));
export const CIRCUITS_DIR = join(here, "..", "..", "circuits");

export function loadArtifacts(dir = CIRCUITS_DIR): Artifacts {
  const names: CircuitName[] = ["transfer", "split", "withdraw"];
  const circuits = Object.fromEntries(names.map((n) => [n, JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"))])) as Artifacts["circuits"];
  const meta = Object.fromEntries(names.map((n) => [n, JSON.parse(readFileSync(join(dir, `${n}.meta.json`), "utf8"))])) as Artifacts["meta"];
  return { circuits, meta };
}
