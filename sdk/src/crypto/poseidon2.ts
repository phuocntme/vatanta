/**
 * Poseidon2 over BN254 (t = 4, Rf = 8, Rp = 56), byte-for-byte compatible with Noir's
 * `noir-lang/poseidon` v0.4.0 `Poseidon2::hash` and Barretenberg's permutation. Round constants
 * are extracted from zemse/poseidon2-evm (which matches Noir; checked in tests).
 */
import params from "./poseidon2-bn254.json" with { type: "json" };
import { P } from "../constants.js";

const DIAG = params.diag.map((h) => BigInt(h));
const ROUNDS = params.rounds.map((r) => ({ external: r.kind === "external", rc: r.rc.map((h) => BigInt(h)) }));

const pow5 = (x: bigint) => {
  const x2 = (x * x) % P;
  return (((x2 * x2) % P) * x) % P;
};

function matExternal(s: bigint[]): void {
  const t0 = s[0] + s[1];
  const t1 = s[2] + s[3];
  const t2 = 2n * s[1] + t1;
  const t3 = 2n * s[3] + t0;
  const t4 = 4n * t1 + t3;
  const t5 = 4n * t0 + t2;
  const t6 = t3 + t5;
  const t7 = t2 + t4;
  s[0] = t6 % P;
  s[1] = t5 % P;
  s[2] = t7 % P;
  s[3] = t4 % P;
}

function matInternal(s: bigint[]): void {
  const sum = (s[0] + s[1] + s[2] + s[3]) % P;
  for (let i = 0; i < 4; i++) s[i] = (s[i] * DIAG[i] + sum) % P;
}

export function permute(input: readonly bigint[]): bigint[] {
  const s = input.map((x) => x % P);
  matExternal(s);
  for (const r of ROUNDS) {
    if (r.external) {
      for (let i = 0; i < 4; i++) s[i] = pow5((s[i] + r.rc[i]) % P);
      matExternal(s);
    } else {
      s[0] = pow5((s[0] + r.rc[0]) % P);
      matInternal(s);
    }
  }
  return s;
}

/** Noir `Poseidon2::hash(inputs, inputs.length)`: sponge, rate 3, IV = len << 64. */
export function poseidon2(inputs: readonly bigint[]): bigint {
  let state = [0n, 0n, 0n, BigInt(inputs.length) << 64n];
  let cache: bigint[] = [];
  const duplex = () => {
    for (let i = 0; i < cache.length; i++) state[i] = (state[i] + cache[i]) % P;
    state = permute(state);
    cache = [];
  };
  for (const x of inputs) {
    if (cache.length === 3) duplex();
    cache.push(x % P);
  }
  duplex();
  return state[0];
}

export const hash2 = (a: bigint, b: bigint) => poseidon2([a, b]);
