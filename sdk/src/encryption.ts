import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bigIntToBytes, bytesToBigInt } from "./crypto/field.js";
import type { Note } from "./note.js";

const enc = new TextEncoder();
const ZERO_NONCE = new Uint8Array(12);
export const CIPHERTEXT_LEN = 32 + 40 + 16;

function noteKey(shared: Uint8Array, epk: Uint8Array) {
  return hkdf(sha256, shared, epk, enc.encode("vatanta/note/v1"), 32);
}

export function viewTagOf(shared: Uint8Array): number {
  const t = new Uint8Array(9 + shared.length);
  t.set(enc.encode("vatanta/tag"), 0);
  t.set(shared, 9);
  return sha256(t)[0];
}

export interface EncryptedNote {
  ciphertext: Uint8Array; // epk ‖ AEAD(amount ‖ blinding)
  viewTag: number;
}

/** Encrypt `amount ‖ blinding` to a recipient viewing key (SPEC.md §4.4). */
export function encryptNote(note: Note, viewPub: Uint8Array, ephemeralSk?: Uint8Array): EncryptedNote {
  const esk = ephemeralSk ?? x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(esk);
  const shared = x25519.getSharedSecret(esk, viewPub);
  const pt = new Uint8Array(40);
  pt.set(bigIntToBytes(note.amount, 8), 0);
  pt.set(bigIntToBytes(note.blinding, 32), 8);
  const ct = chacha20poly1305(noteKey(shared, epk), ZERO_NONCE).encrypt(pt);
  const out = new Uint8Array(32 + ct.length);
  out.set(epk, 0);
  out.set(ct, 32);
  return { ciphertext: out, viewTag: viewTagOf(shared) };
}

/**
 * Try to open a ciphertext with our viewing key. Returns null when the view tag does not match
 * (≈255/256 of foreign notes) or decryption fails. The caller must still check the commitment.
 */
export function tryDecryptNote(
  ciphertext: Uint8Array,
  viewTag: number,
  viewSk: Uint8Array,
): { amount: bigint; blinding: bigint } | null {
  if (ciphertext.length !== CIPHERTEXT_LEN) return null;
  const epk = ciphertext.slice(0, 32);
  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(viewSk, epk);
  } catch {
    return null;
  }
  if (viewTagOf(shared) !== viewTag) return null;
  try {
    const pt = chacha20poly1305(noteKey(shared, epk), ZERO_NONCE).decrypt(ciphertext.slice(32));
    return { amount: bytesToBigInt(pt.slice(0, 8)), blinding: bytesToBigInt(pt.slice(8, 40)) };
  } catch {
    return null;
  }
}
