import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** Persists the wallet's private state. Everything stored is encrypted with a key from the seed. */
export interface KV {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array): Promise<void>;
}

export class MemoryKV implements KV {
  private m = new Map<string, Uint8Array>();
  async get(k: string) {
    return this.m.get(k);
  }
  async set(k: string, v: Uint8Array) {
    this.m.set(k, v);
  }
}

/** IndexedDB-backed store (browser). */
export class IndexedDbKV implements KV {
  async get(k: string) {
    const { get } = await import("idb-keyval");
    return (await get(k)) as Uint8Array | undefined;
  }
  async set(k: string, v: Uint8Array) {
    const { set } = await import("idb-keyval");
    await set(k, v);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const replacer = (_: string, v: unknown) => (typeof v === "bigint" ? { $big: v.toString() } : v instanceof Uint8Array ? { $u8: Array.from(v) } : v);
const reviver = (_: string, v: unknown) => {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("$big" in o) return BigInt(o.$big as string);
    if ("$u8" in o) return Uint8Array.from(o.$u8 as number[]);
  }
  return v;
};

export class EncryptedStore {
  private key?: CryptoKey;
  constructor(private kv: KV, private seed: Uint8Array, private namespace: string) {}

  private async k() {
    if (!this.key) {
      const raw = hkdf(sha256, this.seed, undefined, enc.encode("vatanta/store/aes-gcm"), 32);
      this.key = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
    }
    return this.key;
  }

  async load<T>(): Promise<T | undefined> {
    const blob = await this.kv.get(this.namespace);
    if (!blob) return undefined;
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12) }, await this.k(), blob.slice(12));
    return JSON.parse(dec.decode(pt), reviver) as T;
  }

  async save<T>(value: T): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.k(), enc.encode(JSON.stringify(value, replacer))),
    );
    const out = new Uint8Array(12 + ct.length);
    out.set(iv, 0);
    out.set(ct, 12);
    await this.kv.set(this.namespace, out);
  }
}
