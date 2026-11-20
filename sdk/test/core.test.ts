import { describe, expect, it } from "vitest";
import {
  decodeAddress, deriveKeys, encodeAddress, isValidAddress, encryptNote, tryDecryptNote, MerkleTree, zeros,
  greedySplit, quoteDeposit, quoteWithdraw, parseUsdc, formatUsdc, pickBatches, nextBatchTime, privacyLevel,
  commitmentOf, nullifierOf, precommitOf, ownerOf, extDataHash, USDC, hash2, matchesRecentDeposit, keyMessage,
  withdrawExtDataHash, ZERO32, ZERO_ADDRESS, P,
} from "../src/index.js";
import v from "./vectors.json" with { type: "json" };

const SIG = ("0x" + "11".repeat(65)) as `0x${string}`;

describe("keys and addresses", () => {
  it("derives deterministically", () => {
    const a = deriveKeys(SIG);
    const b = deriveKeys(SIG);
    expect(a.sk).toBe(b.sk);
    expect(a.address).toBe(b.address);
    expect(a.address.startsWith("zk1")).toBe(true);
    expect(a.owner).toBe(ownerOf(a.sk));
  });
  it("round-trips the address", () => {
    const k = deriveKeys(SIG);
    const d = decodeAddress(k.address);
    expect(d.owner).toBe(k.owner);
    expect(Buffer.from(d.viewPub).equals(Buffer.from(k.viewPub))).toBe(true);
    expect(encodeAddress(d.owner, d.viewPub)).toBe(k.address);
  });
  it("rejects corrupted addresses", () => {
    const k = deriveKeys(SIG);
    const bad = k.address.slice(0, -1) + (k.address.endsWith("q") ? "p" : "q");
    expect(isValidAddress(bad)).toBe(false);
    expect(isValidAddress("0x1234")).toBe(false);
  });
});

describe("note hashing matches Noir", () => {
  it("commitment and nullifier", () => {
    const owner = ownerOf(42n);
    expect(owner).toBe(BigInt(v.owner_42));
    expect(precommitOf(owner, 7n)).toBe(BigInt(v.precommit_owner42_7));
    const c = commitmentOf({ amount: 10n * USDC, owner, blinding: 7n });
    expect(c).toBe(BigInt(v.commitment_10usdc_owner42_7));
    expect(nullifierOf(c, 42n, 5)).toBe(BigInt(v.nullifier_above_sk42_idx5));
  });
});

describe("note encryption", () => {
  const alice = deriveKeys(SIG);
  const bob = deriveKeys(("0x" + "22".repeat(65)) as `0x${string}`);
  const note = { amount: 250n * USDC, owner: bob.owner, blinding: 123456789n };
  it("recipient decrypts", () => {
    const e = encryptNote(note, bob.viewPub);
    expect(e.ciphertext.length).toBe(88);
    const d = tryDecryptNote(e.ciphertext, e.viewTag, bob.viewSk);
    expect(d).toEqual({ amount: note.amount, blinding: note.blinding });
  });
  it("others cannot", () => {
    const e = encryptNote(note, bob.viewPub);
    expect(tryDecryptNote(e.ciphertext, e.viewTag, alice.viewSk)).toBeNull();
  });
  it("view tag filters ~1/256", () => {
    let matches = 0;
    for (let i = 0; i < 2000; i++) {
      const e = encryptNote(note, bob.viewPub);
      // alice checks: tag compare happens before AEAD
      if (tryDecryptNote(e.ciphertext, e.viewTag, alice.viewSk) !== null) matches++;
    }
    expect(matches).toBe(0);
  }, 30_000); // 2000 ECDH encryptions: ~3 s locally, can pass 5 s on CI runners
});

describe("merkle tree", () => {
  it("matches contract-style root for a single leaf", () => {
    const t = new MerkleTree([5n]);
    let node = 5n;
    for (let d = 0; d < 32; d++) node = hash2(node, zeros()[d]);
    expect(t.root).toBe(node);
  });
  it("paths verify for every leaf, incremental == bulk", () => {
    const leaves = Array.from({ length: 37 }, (_, i) => BigInt(i * 7 + 1));
    const bulk = new MerkleTree(leaves);
    const inc = new MerkleTree();
    for (const l of leaves.slice(0, 10)) inc.insert(l);
    inc.insertMany(leaves.slice(10));
    expect(inc.root).toBe(bulk.root);
    for (let i = 0; i < leaves.length; i++) {
      expect(MerkleTree.rootFromPath(leaves[i], i, bulk.path(i))).toBe(bulk.root);
    }
  });
});

describe("amounts", () => {
  it("greedy split matches the design example", () => {
    expect(greedySplit(2350n * USDC).map((x) => x / USDC)).toEqual([1000n, 1000n, 100n, 100n, 100n, 10n, 10n, 10n, 10n, 10n]);
    expect(greedySplit(2359_990000n).length).toBe(10); // rounded down to 2,350
  });
  it("deposit quote: 2,350 -> fee 5.875, net 2,344.125", () => {
    const q = quoteDeposit(parseUsdc("2,350"));
    expect(q.fee).toBe(5_875_000n);
    expect(q.net).toBe(2_344_125_000n);
    expect(quoteDeposit(parseUsdc("19.99")).ok).toBe(false);
    expect(quoteDeposit(parseUsdc("25")).remainder).toBe(5n * USDC);
  });
  it("withdraw quote enforces 12 pieces", () => {
    expect(quoteWithdraw(parseUsdc("2350")).ok).toBe(true);
    expect(quoteWithdraw(parseUsdc("1990")).pieces.length).toBe(19);
    expect(quoteWithdraw(parseUsdc("1990")).ok).toBe(false);
  });
  it("formats", () => {
    expect(formatUsdc(2_344_125_000n)).toBe("2,344.125");
    expect(formatUsdc(250n * USDC)).toBe("250.00");
    expect(formatUsdc(-100_000n)).toBe("−0.10");
  });
  it("pattern warning", () => {
    expect(matchesRecentDeposit(1000n * USDC, [1000n * USDC])).toBe(true);
    expect(matchesRecentDeposit(990n * USDC, [1000n * USDC])).toBe(false);
  });
});

describe("schedule", () => {
  it("fast = next batch, standard within 6h, max within 24h", () => {
    const now = 1_000_123;
    const next = nextBatchTime(now);
    expect(next % 600).toBe(0);
    expect(pickBatches(5, "fast", now).every((b) => b === next)).toBe(true);
    const std = pickBatches(500, "standard", now);
    expect(std.every((b) => b >= next && b < next + 6 * 3600 && b % 600 === 0)).toBe(true);
    expect(new Set(std).size).toBeGreaterThan(10);
    const mx = pickBatches(500, "max", now);
    expect(mx.every((b) => b < next + 24 * 3600)).toBe(true);
  });
  it("privacy levels", () => {
    expect(privacyLevel(20)).toBe("green");
    expect(privacyLevel(19)).toBe("yellow");
    expect(privacyLevel(5)).toBe("yellow");
    expect(privacyLevel(4)).toBe("red");
  });
});

describe("ext data hash", () => {
  it("is a field element and order-sensitive", () => {
    const a = extDataHash([{ ciphertext: "0x01", viewTag: 1 }, { ciphertext: "0x02", viewTag: 2 }]);
    const b = extDataHash([{ ciphertext: "0x02", viewTag: 2 }, { ciphertext: "0x01", viewTag: 1 }]);
    expect(a).not.toBe(b);
  });
});

describe("withdraw ext data hash (SPEC §14)", () => {
  it("is 0 for C-Chain and binds the L1 destination otherwise", () => {
    expect(withdrawExtDataHash(ZERO32, ZERO_ADDRESS)).toBe(0n);
    const echo = `0x${"ec40".padStart(64, "0")}` as const;
    const h = withdrawExtDataHash(echo, "0x0000000000000000000000000000000000000ec0");
    expect(h).toBeGreaterThan(0n);
    expect(h < P).toBe(true);
    expect(withdrawExtDataHash(echo, "0x0000000000000000000000000000000000000ec1")).not.toBe(h);
    // keccak256(abi.encode(bytes32, address)) mod p, computed independently with `cast`
    expect(h).toBe(14225482561314537236041581071990248636684490766137792449373243338463504186496n);
  });
});

describe("keyMessage (SIWE, external wallets)", () => {
  const address = "0x0217f30b94127BA140f6f1b805e64c5305a1F2aE";
  it("is EIP-4361 shaped and deterministic", () => {
    const m = keyMessage({ address, domain: "app.vatanta.xyz", chainId: 43113 });
    expect(m).toBe(keyMessage({ address, domain: "app.vatanta.xyz", chainId: 43113 }));
    const lines = m.split("\n");
    expect(lines[0]).toBe("app.vatanta.xyz wants you to sign in with your Ethereum account:");
    expect(lines[1]).toBe(address);
    expect(lines[2]).toBe("");
    expect(lines[4]).toBe("");
    expect(lines.slice(5)).toEqual([
      "URI: https://app.vatanta.xyz",
      "Version: 1",
      "Chain ID: 43113",
      "Nonce: vatantakeysv2",
      "Issued At: 2026-01-01T00:00:00.000Z",
    ]);
    expect(lines[3]).not.toContain("\n");
  });
  it("binds the account to the domain", () => {
    expect(keyMessage({ address, domain: "app.vatanta.xyz", chainId: 43113 })).not.toBe(keyMessage({ address, domain: "vatanta-app.xyz", chainId: 43113 }));
  });
  it("uses http for local hosts and rejects bad input", () => {
    expect(keyMessage({ address, domain: "localhost:4001", chainId: 43113 })).toContain("URI: http://localhost:4001");
    expect(() => keyMessage({ address: "0x12", domain: "a.b", chainId: 1 })).toThrow();
    expect(() => keyMessage({ address, domain: "https://a.b", chainId: 1 })).toThrow();
  });
});
