import { P } from "../constants.js";

export const mod = (x: bigint): bigint => ((x % P) + P) % P;

export function toHex32(x: bigint): `0x${string}` {
  return `0x${x.toString(16).padStart(64, "0")}`;
}

export function bytesToBigInt(b: Uint8Array): bigint {
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return x;
}

export function bigIntToBytes(x: bigint, len = 32): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** Uniform field element from CSPRNG (rejection-free: 64 bytes reduced mod p). */
export function randomField(): bigint {
  const b = new Uint8Array(64);
  crypto.getRandomValues(b);
  return bytesToBigInt(b) % P;
}

export function isField(x: bigint): boolean {
  return x >= 0n && x < P;
}
