import { describe, expect, it } from "vitest";
import { hash2, poseidon2 } from "../src/crypto/poseidon2.js";
import v from "./vectors.json" with { type: "json" };

describe("poseidon2 matches Noir", () => {
  it("hash2(3,4)", () => expect(hash2(3n, 4n)).toBe(BigInt(v.hash2_3_4)));
  it("hash2(1,2)", () => expect(hash2(1n, 2n)).toBe(BigInt(v.hash2_1_2)));
  it("owner", () => expect(poseidon2([1n, 42n])).toBe(BigInt(v.owner_42)));
  it("3-input", () => expect(poseidon2([2n, BigInt(v.owner_42), 7n])).toBe(BigInt(v.precommit_owner42_7)));
  it("4-input (two permutations)", () => {
    const c = BigInt(v.commitment_10usdc_owner42_7);
    expect(poseidon2([4n, c, 42n, 5n])).toBe(BigInt(v.nullifier_above_sk42_idx5));
  });
});
