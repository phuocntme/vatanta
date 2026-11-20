import { keccak_256 } from "@noble/hashes/sha3.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { bech32m } from "@scure/base";
import { ADDRESS_HRP, DOM, P } from "./constants.js";
import { bigIntToBytes, bytesToBigInt } from "./crypto/field.js";
import { poseidon2 } from "./crypto/poseidon2.js";

const enc = new TextEncoder();

export interface ShieldedKeys {
  /** keccak256(signature) — root of every other key */
  seed: Uint8Array;
  /** spending secret (field element) — never leaves the device */
  sk: bigint;
  /** spending pubkey = H(1, sk) — appears inside notes */
  owner: bigint;
  viewSk: Uint8Array;
  viewPub: Uint8Array;
  address: string;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2) throw new Error("odd hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): `0x${string}` {
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** Derive all keys from the wallet's signature over KEY_MESSAGE (SPEC.md §4.2). */
export function deriveKeys(signature: `0x${string}` | Uint8Array): ShieldedKeys {
  const sig = typeof signature === "string" ? hexToBytes(signature) : signature;
  return deriveKeysFromSeed(keccak_256(sig));
}

export function deriveKeysFromSeed(seed: Uint8Array): ShieldedKeys {
  const hi = bytesToBigInt(seed.slice(0, 16));
  const lo = bytesToBigInt(seed.slice(16, 32));
  const sk = poseidon2([DOM.SPEND, hi, lo]) % P;
  const owner = poseidon2([DOM.OWNER, sk]);
  const viewSk = hkdf(sha256, seed, undefined, enc.encode("vatanta/view/x25519"), 32);
  const viewPub = x25519.getPublicKey(viewSk);
  return { seed, sk, owner, viewSk, viewPub, address: encodeAddress(owner, viewPub) };
}

export function encodeAddress(owner: bigint, viewPub: Uint8Array): string {
  const payload = new Uint8Array(64);
  payload.set(bigIntToBytes(owner, 32), 0);
  payload.set(viewPub, 32);
  return bech32m.encode(ADDRESS_HRP, bech32m.toWords(payload), 200);
}

export interface ShieldedAddress {
  owner: bigint;
  viewPub: Uint8Array;
}

export function decodeAddress(addr: string): ShieldedAddress {
  const { prefix, words } = bech32m.decode(addr as `${string}1${string}`, 200);
  if (prefix !== ADDRESS_HRP) throw new Error("not a zk1 address");
  const b = bech32m.fromWords(words);
  if (b.length !== 64) throw new Error("bad address length");
  const owner = bytesToBigInt(b.slice(0, 32));
  if (owner >= P) throw new Error("bad owner");
  return { owner, viewPub: b.slice(32) };
}

export function isValidAddress(addr: string): boolean {
  try {
    decodeAddress(addr.trim());
    return true;
  } catch {
    return false;
  }
}

/** Short display form, e.g. zk1q8f…4f2a */
export function shortAddress(addr: string, head = 6, tail = 4): string {
  return addr.length <= head + tail + 1 ? addr : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
