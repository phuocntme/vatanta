import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { P, MAX_PIECES } from "../constants.js";
import { toHex32 } from "../crypto/field.js";
import { zeros } from "../merkle.js";
import type { Note } from "../note.js";
import { bytesToHex } from "../keys.js";

export interface SpendInput {
  amount: bigint;
  blinding: bigint;
  leafIndex: number;
  path: bigint[];
}

export const dummyInput = (blinding: bigint): SpendInput => ({ amount: 0n, blinding, leafIndex: 0, path: zeros().slice(0, 32) });

export interface NoteDataHex {
  ciphertext: Hex;
  viewTag: number;
}

export const noteData = (ct: Uint8Array, viewTag: number): NoteDataHex => ({ ciphertext: bytesToHex(ct), viewTag });
export const EMPTY_NOTE: NoteDataHex = { ciphertext: "0x", viewTag: 0 };

/** keccak256(abi.encode(NoteData[])) mod p — must equal ShieldedPool._extDataHash. */
export function extDataHash(notes: NoteDataHex[]): bigint {
  const enc = encodeAbiParameters(
    [{ type: "tuple[]", components: [{ type: "bytes", name: "ciphertext" }, { type: "uint8", name: "viewTag" }] }],
    [notes],
  );
  return BigInt(keccak256(enc)) % P;
}

const f = (x: bigint) => toHex32(x);
const inNote = (s: SpendInput) => ({
  amount: s.amount.toString(),
  blinding: f(s.blinding),
  leaf_index: s.leafIndex,
  path: s.path.map(f),
});
const outNote = (n: Note) => ({ amount: n.amount.toString(), owner: f(n.owner), blinding: f(n.blinding) });
const addr = (a: Address) => f(BigInt(a));

export interface Context {
  relayer: Address;
  chainId: number;
  pool: Address;
}

export interface TransferPublic {
  root: bigint;
  nullifiers: [bigint, bigint];
  commitments: [bigint, bigint];
  fee: bigint;
  relayer: Address;
  notes: [NoteDataHex, NoteDataHex];
}

export function transferInputs(sk: bigint, ins: [SpendInput, SpendInput], outs: [Note, Note], pub: TransferPublic, ctx: Context) {
  return {
    root: f(pub.root),
    nullifiers: pub.nullifiers.map(f),
    out_commitments: pub.commitments.map(f),
    fee: pub.fee.toString(),
    relayer: addr(ctx.relayer),
    chain_id: f(BigInt(ctx.chainId)),
    pool: addr(ctx.pool),
    ext_data_hash: f(extDataHash(pub.notes)),
    sk: f(sk),
    inputs: ins.map(inNote),
    outputs: outs.map(outNote),
  };
}

export interface SplitPublic {
  root: bigint;
  nullifiers: [bigint, bigint];
  denomCommitments: bigint[]; // length 12, 0 = empty
  changeCommitment: bigint;
  fee: bigint;
  relayer: Address;
  notes: NoteDataHex[]; // length 13
}

export function splitInputs(
  sk: bigint,
  ins: [SpendInput, SpendInput],
  denoms: { amount: bigint; blinding: bigint }[],
  change: Note,
  pub: SplitPublic,
  ctx: Context,
) {
  const amounts = Array.from({ length: MAX_PIECES }, (_, i) => (denoms[i]?.amount ?? 0n).toString());
  const blindings = Array.from({ length: MAX_PIECES }, (_, i) => f(denoms[i]?.blinding ?? 0n));
  return {
    root: f(pub.root),
    nullifiers: pub.nullifiers.map(f),
    denom_commitments: pub.denomCommitments.map(f),
    change_commitment: f(pub.changeCommitment),
    fee: pub.fee.toString(),
    relayer: addr(ctx.relayer),
    chain_id: f(BigInt(ctx.chainId)),
    pool: addr(ctx.pool),
    ext_data_hash: f(extDataHash(pub.notes)),
    sk: f(sk),
    inputs: ins.map(inNote),
    denom_amounts: amounts,
    denom_blindings: blindings,
    change_amount: change.amount.toString(),
    change_owner: f(change.owner),
    change_blinding: f(change.blinding),
  };
}

export interface WithdrawPublic {
  root: bigint;
  nullifier: bigint;
  amount: bigint;
  recipient: Address;
  relayer: Address;
  /** 0x00…0 = C-Chain; otherwise the destination L1's blockchain id (SPEC §14) */
  destBlockchainId: Hex;
  /** zero address for C-Chain; otherwise the ICTT TokenRemote on the destination L1 */
  destTransferrer: Address;
}

export const ZERO32 = `0x${"0".repeat(64)}` as Hex;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

/** ext_data_hash of a withdraw proof — must equal ShieldedPool.withdrawExtDataHash. */
export function withdrawExtDataHash(destBlockchainId: Hex, destTransferrer: Address): bigint {
  if (BigInt(destBlockchainId) === 0n && BigInt(destTransferrer) === 0n) return 0n;
  const enc = encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [destBlockchainId, destTransferrer]);
  return BigInt(keccak256(enc)) % P;
}

export function withdrawInputs(sk: bigint, input: SpendInput, pub: WithdrawPublic, ctx: Context) {
  return {
    root: f(pub.root),
    nullifier: f(pub.nullifier),
    amount: pub.amount.toString(),
    recipient: addr(pub.recipient),
    relayer: addr(ctx.relayer),
    chain_id: f(BigInt(ctx.chainId)),
    pool: addr(ctx.pool),
    ext_data_hash: f(withdrawExtDataHash(pub.destBlockchainId, pub.destTransferrer)),
    sk: f(sk),
    input: inNote(input),
  };
}
