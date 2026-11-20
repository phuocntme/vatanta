import { HDKey } from "@scure/bip32";
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { bytesToHex } from "./keys.js";
import { toHex32 } from "./crypto/field.js";
import { depositBlinding, precommitOf } from "./note.js";
import type { ShieldedKeys } from "./keys.js";
import { BRAND } from "./constants.js";

const DEPOSIT_PATH = (i: number) => `m/44'/60'/7777'/0/${i}`;
const EXIT_PATH = (i: number) => `m/44'/60'/7777'/1/${i}`;

function accountAt(seed: Uint8Array, path: string): PrivateKeyAccount {
  const k = HDKey.fromMasterSeed(seed).derive(path);
  if (!k.privateKey) throw new Error("derivation failed");
  return privateKeyToAccount(bytesToHex(k.privateKey));
}

/** One-time C-Chain deposit address #i (BIP-32 from the signature seed; never reused). */
export const depositAccount = (keys: ShieldedKeys, i: number) => accountAt(keys.seed, DEPOSIT_PATH(i));

/** Fresh C-Chain exit address #i for withdrawal pieces (user controls the key). */
export const exitAccount = (keys: ShieldedKeys, i: number) => accountAt(keys.seed, EXIT_PATH(i));

export interface PlannedPiece {
  denomination: bigint;
  blindingIndex: number;
  blinding: bigint;
  precommit: bigint;
}

/** Precommitments for each deposit piece, from deterministic blindings (recoverable from seed). */
export function planDepositPieces(keys: ShieldedKeys, pieces: bigint[], firstBlindingIndex: number): PlannedPiece[] {
  return pieces.map((denomination, k) => {
    const blindingIndex = firstBlindingIndex + k;
    const blinding = depositBlinding(keys.sk, blindingIndex);
    return { denomination, blindingIndex, blinding, precommit: precommitOf(keys.owner, blinding) };
  });
}

export interface DepositIntent {
  owner: Address;
  gross: bigint;
  pieces: { denomination: bigint; precommit: Hex }[];
  feeRecipient: Address;
  nonce: bigint;
  deadline: bigint;
}

export interface Sig {
  v: number;
  r: Hex;
  s: Hex;
}

export const piecesHash = (pieces: DepositIntent["pieces"]) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "tuple[]", components: [{ type: "uint256", name: "denomination" }, { type: "bytes32", name: "precommit" }] }],
      [pieces],
    ),
  );

function splitSig(sig: Hex): Sig {
  const r = `0x${sig.slice(2, 66)}` as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  let v = parseInt(sig.slice(130, 132), 16);
  if (v < 27) v += 27;
  return { v, r, s };
}

export interface TokenDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

export interface SignedDeposit {
  intent: DepositIntent;
  permitSig: Sig;
  intentSig: Sig;
}

/** Anything that can sign EIP-712 data: a local account or a wrapped browser wallet. */
export interface TypedSigner {
  address: Address;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signTypedData(args: any): Promise<Hex>;
}

/** Signs the EIP-2612 permit and the DepositIntent with the depositing address's key. */
export async function signDeposit(args: {
  account: TypedSigner;
  router: Address;
  chainId: number;
  token: TokenDomain;
  permitNonce: bigint;
  gross: bigint;
  pieces: PlannedPiece[];
  feeRecipient: Address;
  deadline: bigint;
  nonce?: bigint;
}): Promise<SignedDeposit> {
  const intent: DepositIntent = {
    owner: args.account.address,
    gross: args.gross,
    pieces: args.pieces.map((p) => ({ denomination: p.denomination, precommit: toHex32(p.precommit) })),
    feeRecipient: args.feeRecipient,
    // the token's permit nonce rises with every use of the address, so a second deposit from the
    // same address (e.g. reused by a restored wallet) gets a fresh intent nonce instead of NonceUsed
    nonce: args.nonce ?? args.permitNonce,
    deadline: args.deadline,
  };
  const permit = await args.account.signTypedData({
    domain: args.token,
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner: intent.owner, spender: args.router, value: args.gross, nonce: args.permitNonce, deadline: args.deadline },
  });
  const intentSig = await args.account.signTypedData({
    domain: { name: `${BRAND} DepositRouter`, version: "1", chainId: args.chainId, verifyingContract: args.router },
    types: {
      DepositIntent: [
        { name: "owner", type: "address" },
        { name: "gross", type: "uint256" },
        { name: "piecesHash", type: "bytes32" },
        { name: "feeRecipient", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "DepositIntent",
    message: {
      owner: intent.owner,
      gross: intent.gross,
      piecesHash: piecesHash(intent.pieces),
      feeRecipient: intent.feeRecipient,
      nonce: intent.nonce,
      deadline: intent.deadline,
    },
  });
  return { intent, permitSig: splitSig(permit), intentSig: splitSig(intentSig) };
}
