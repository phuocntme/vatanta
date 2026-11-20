import { DOM } from "./constants.js";
import { poseidon2 } from "./crypto/poseidon2.js";
import { randomField } from "./crypto/field.js";

export interface Note {
  amount: bigint; // micro-USDC
  owner: bigint;
  blinding: bigint;
}

/** A note we own, with its tree position once known. */
export interface OwnedNote extends Note {
  commitment: bigint;
  leafIndex: number;
  nullifier: bigint;
  /** where it came from, for history */
  source: "deposit" | "receive" | "change" | "split";
  createdAt: number; // unix seconds (block time)
  spent: boolean;
  /** gross denomination for deposit notes */
  denomination?: bigint;
  txHash?: string;
}

export const ownerOf = (sk: bigint) => poseidon2([DOM.OWNER, sk]);
export const precommitOf = (owner: bigint, blinding: bigint) => poseidon2([DOM.PRE, owner, blinding]);
export const commitmentOf = (n: Note) => poseidon2([DOM.NOTE, n.amount, precommitOf(n.owner, n.blinding)]);
export const commitmentFromPrecommit = (amount: bigint, precommit: bigint) => poseidon2([DOM.NOTE, amount, precommit]);
export const nullifierOf = (commitment: bigint, sk: bigint, leafIndex: number) =>
  poseidon2([DOM.NULL, commitment, sk, BigInt(leafIndex)]);

/** Deterministic deposit blinding #i — lets a wallet rediscover its own deposits from the seed. */
export const depositBlinding = (sk: bigint, i: number) => poseidon2([DOM.BLIND, sk, BigInt(i)]);

export function newNote(amount: bigint, owner: bigint, blinding = randomField()): Note {
  return { amount, owner, blinding };
}
