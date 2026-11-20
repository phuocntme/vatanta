import type { Address, Hex } from "viem";
import { MAX_PIECES, SEND_FEE, DENOMINATIONS, PATTERN_WINDOW_SECS } from "./constants.js";
import { randomField } from "./crypto/field.js";
import { decodeAddress, shortAddress, type ShieldedKeys } from "./keys.js";
import { MerkleTree } from "./merkle.js";
import { commitmentOf, depositBlinding, nullifierOf, precommitOf, type Note, type OwnedNote } from "./note.js";
import { encryptNote, tryDecryptNote } from "./encryption.js";
import { hexToBytes } from "./keys.js";
import type { DataSource, PoolEvent } from "./events.js";
import { EncryptedStore, MemoryKV, type KV } from "./store.js";
import {
  dummyInput,
  EMPTY_NOTE,
  noteData,
  splitInputs,
  transferInputs,
  withdrawInputs,
  type Context,
  type NoteDataHex,
  type SpendInput,
  type SplitPublic,
  type TransferPublic,
  type WithdrawPublic,
  ZERO32,
  ZERO_ADDRESS,
} from "./prover/inputs.js";
import type { ProofResult, ProverLike as Prover } from "./prover/index.js";
import { exitAccount, depositAccount, planDepositPieces, type PlannedPiece } from "./deposit.js";
import { greedySplit } from "./amounts.js";
import { privacyLevel, type PrivacyLevel } from "./schedule.js";

export type HistoryKind = "deposit" | "send" | "receive" | "withdraw" | "split" | "merge";

export interface HistoryItem {
  id: string;
  kind: HistoryKind;
  /** signed micro-USDC from the user's point of view */
  amount: bigint;
  counterparty?: string;
  isPrivate: boolean;
  status: "pending" | "confirmed" | "queued" | "failed";
  time: number;
  pieces?: number;
  detail?: string;
  tx?: Hex;
}

interface DepositRecord {
  address: Address;
  addressIndex: number;
  gross: bigint;
  pieces: PlannedPiece[];
  createdAt: number;
  confirmedPieces: number;
  historyId: string;
}

export interface PendingDeposit {
  address: Address;
  /** -1 when the deposit comes from the user's own wallet */
  addressIndex: number;
  gross: bigint;
  pieces: PlannedPiece[];
  createdAt: number;
  confirmedPieces: number;
}

/** Where a withdrawal lands: C-Chain (default) or an L1 from the DestinationRegistry (SPEC §14). */
export interface WithdrawDestination {
  /** Avalanche blockchain id of the L1 (bytes32 hex) */
  blockchainId: Hex;
  /** ICTT TokenRemote of Vatanta's home on that L1 */
  tokenRemote: Address;
  name: string;
  evmChainId?: number;
}

interface WithdrawalPiece {
  nullifier: bigint;
  denomination: bigint;
  recipient: Address;
  /** destination L1 name; absent = C-Chain */
  destination?: string;
  batch: number;
  status: "queued" | "sent";
  tx?: Hex;
  historyId?: string;
}

interface ExpectedOutput {
  source: OwnedNote["source"];
  historyId: string;
}

export interface WalletState {
  version: 1;
  cursor: number;
  leaves: bigint[];
  notes: OwnedNote[];
  pendingSpent: bigint[];
  expected: [string, ExpectedOutput][];
  nextBlindingIndex: number;
  nextDepositAddress: number;
  nextExitAddress: number;
  history: HistoryItem[];
  deposits: DepositRecord[];
  withdrawals: WithdrawalPiece[];
  /** public pool activity, for the privacy meter: [leafIndex, denomination, time] */
  depositLog: [number, bigint, number][];
  /** [denomination, time] */
  withdrawalLog: [bigint, number][];
  receivedCommitments: string[];
}

const emptyState = (): WalletState => ({
  version: 1,
  cursor: 0,
  leaves: [],
  notes: [],
  pendingSpent: [],
  expected: [],
  nextBlindingIndex: 0,
  nextDepositAddress: 0,
  nextExitAddress: 0,
  history: [],
  deposits: [],
  withdrawals: [],
  depositLog: [],
  withdrawalLog: [],
  receivedCommitments: [],
});

export interface PreparedTx<A> {
  kind: "transfer" | "split" | "withdraw";
  proof: ProofResult;
  args: A;
  spent: bigint[];
  historyId: string;
}

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
const now = () => Math.floor(Date.now() / 1000);

export class Wallet {
  readonly tree = new MerkleTree();
  private precommitIndex = new Map<string, number>();
  private expected = new Map<string, ExpectedOutput>();
  rootOk = true;

  private constructor(
    readonly keys: ShieldedKeys,
    private source: DataSource,
    private store: EncryptedStore,
    private s: WalletState,
  ) {
    this.tree.insertMany(s.leaves);
    for (const [k, v] of s.expected) this.expected.set(k, v);
    this.indexPrecommits();
  }

  static async open(opts: { keys: ShieldedKeys; source: DataSource; kv?: KV; namespace?: string }): Promise<Wallet> {
    const store = new EncryptedStore(opts.kv ?? new MemoryKV(), opts.keys.seed, opts.namespace ?? `vatanta:${opts.keys.address.slice(0, 16)}`);
    const s = (await store.load<WalletState>()) ?? emptyState();
    return new Wallet(opts.keys, opts.source, store, s);
  }

  /** Precommitments for every deterministic blinding we may have used (+64 look-ahead for recovery). */
  private indexPrecommits() {
    const upto = this.s.nextBlindingIndex + 64;
    for (let i = this.precommitIndex.size; i < upto; i++) {
      this.precommitIndex.set(precommitOf(this.keys.owner, depositBlinding(this.keys.sk, i)).toString(), i);
    }
  }

  async save() {
    this.s.expected = [...this.expected.entries()];
    await this.store.save(this.s);
  }

  // ------------------------------------------------------------------ reading
  get address() {
    return this.keys.address;
  }
  get state(): Readonly<WalletState> {
    return this.s;
  }

  spendable(): OwnedNote[] {
    const pend = new Set(this.s.pendingSpent.map(String));
    return this.s.notes.filter((n) => !n.spent && !pend.has(n.nullifier.toString()) && n.amount > 0n);
  }

  balance(): bigint {
    return this.spendable().reduce((a, n) => a + n.amount, 0n);
  }

  pendingBalance(): bigint {
    const pend = new Set(this.s.pendingSpent.map(String));
    return this.s.notes.filter((n) => !n.spent && pend.has(n.nullifier.toString())).reduce((a, n) => a + n.amount, 0n);
  }

  history(): HistoryItem[] {
    return [...this.s.history].sort((a, b) => b.time - a.time);
  }

  /** Gross totals of the user's deposits in the pattern window (for the pattern warning). */
  recentDepositTotals(nowSecs = now()): bigint[] {
    return this.s.deposits.filter((d) => nowSecs - d.createdAt <= PATTERN_WINDOW_SECS).map((d) => d.gross);
  }

  /**
   * Privacy meter (SPEC.md §2): same-denomination deposits since the user's latest deposit,
   * minus same-denomination withdrawals since then.
   */
  anonymitySet(denomination: bigint): { n: number; level: PrivacyLevel } {
    const mine = this.s.notes.filter((n) => n.source === "deposit").map((n) => n.createdAt);
    const since = mine.length ? Math.max(...mine) : 0;
    const myLeaves = new Set(this.s.notes.map((n) => n.leafIndex));
    const deposits = this.s.depositLog.filter(([leaf, d, t]) => d === denomination && t >= since && !myLeaves.has(leaf)).length;
    const withdrawals = this.s.withdrawalLog.filter(([d, t]) => d === denomination && t >= since).length;
    const n = Math.max(0, deposits - withdrawals);
    return { n, level: privacyLevel(n) };
  }

  // ------------------------------------------------------------------ sync
  async sync(): Promise<{ newEvents: number; received: OwnedNote[] }> {
    const page = await this.source.events(this.s.cursor);
    const received: OwnedNote[] = [];
    const newLeaves: bigint[] = [];
    const leafBase = this.s.leaves.length;
    const pushLeaf = (idx: number, c: bigint) => {
      const expectedIdx = leafBase + newLeaves.length;
      if (idx < expectedIdx) return false; // already have it (overlapping page)
      if (idx !== expectedIdx) throw new Error(`leaf gap: got ${idx}, expected ${expectedIdx}`);
      newLeaves.push(c);
      return true;
    };
    for (const e of page.events) {
      if (e.kind === "deposit") {
        if (!pushLeaf(e.leafIndex, e.commitment)) continue;
        this.s.depositLog.push([e.leafIndex, e.denomination, e.time]);
        const bi = this.precommitIndex.get(e.precommit.toString());
        if (bi !== undefined) {
          const note = this.addNote({ amount: e.amount, owner: this.keys.owner, blinding: depositBlinding(this.keys.sk, bi) }, e, "deposit");
          note.denomination = e.denomination;
          this.onDepositConfirmed(e.precommit, e.tx, e.time);
          if (bi >= this.s.nextBlindingIndex) {
            this.s.nextBlindingIndex = bi + 1;
            this.indexPrecommits();
          }
        }
      } else if (e.kind === "note") {
        if (!pushLeaf(e.leafIndex, e.commitment)) continue;
        const opened = tryDecryptNote(hexToBytes(e.ciphertext), e.viewTag, this.keys.viewSk);
        if (!opened) continue;
        const n: Note = { amount: opened.amount, owner: this.keys.owner, blinding: opened.blinding };
        if (commitmentOf(n) !== e.commitment) continue; // not ours / forged ciphertext
        const exp = this.expected.get(e.commitment.toString());
        const note = this.addNote(n, e, exp?.source ?? "receive");
        if (exp) {
          this.expected.delete(e.commitment.toString());
          this.setHistoryStatus(exp.historyId, "confirmed", e.tx);
        } else if (n.amount > 0n) {
          received.push(note);
          this.s.history.push({ id: newId(), kind: "receive", amount: n.amount, isPrivate: true, status: "confirmed", time: e.time, tx: e.tx, counterparty: "shielded sender" });
        }
      } else if (e.kind === "nullifier") {
        for (const n of this.s.notes) if (n.nullifier === e.nullifier) n.spent = true;
        this.s.pendingSpent = this.s.pendingSpent.filter((x) => x !== e.nullifier);
      } else if (e.kind === "withdrawal") {
        this.s.withdrawalLog.push([e.denomination, e.time]);
        const w = this.s.withdrawals.find((x) => x.nullifier === e.nullifier);
        if (w) {
          w.status = "sent";
          w.tx = e.tx;
          this.refreshWithdrawHistory();
        }
      }
    }
    if (newLeaves.length) {
      this.tree.insertMany(newLeaves);
      this.s.leaves.push(...newLeaves);
    }
    this.s.cursor = page.cursor;
    if (this.source.isKnownRoot && this.tree.size > 0) {
      // Independent check: the root we rebuilt must be one the pool accepts.
      this.rootOk = await this.source.isKnownRoot(this.tree.root);
    }
    await this.save();
    return { newEvents: page.events.length, received };
  }

  private addNote(n: Note, e: Extract<PoolEvent, { leafIndex: number }>, source: OwnedNote["source"]): OwnedNote {
    const existing = this.s.notes.find((x) => x.leafIndex === e.leafIndex);
    if (existing) return existing;
    const note: OwnedNote = {
      ...n,
      commitment: e.commitment,
      leafIndex: e.leafIndex,
      nullifier: nullifierOf(e.commitment, this.keys.sk, e.leafIndex),
      source,
      createdAt: e.time,
      spent: false,
      txHash: e.tx,
    };
    this.s.notes.push(note);
    return note;
  }

  private onDepositConfirmed(precommit: bigint, tx: Hex, time: number) {
    for (const d of this.s.deposits) {
      if (d.pieces.some((p) => p.precommit === precommit)) {
        d.confirmedPieces++;
        const h = this.s.history.find((x) => x.id === d.historyId);
        if (h) {
          h.status = d.confirmedPieces >= d.pieces.length ? "confirmed" : "pending";
          h.detail = `${d.confirmedPieces}/${d.pieces.length} pieces in pool`;
          h.tx = tx;
          h.time = Math.max(h.time, time);
        }
        return;
      }
    }
    // recovered deposit with no local record
    this.s.history.push({ id: newId(), kind: "deposit", amount: 0n, isPrivate: false, status: "confirmed", time, tx, detail: "recovered" });
  }

  private setHistoryStatus(id: string, status: HistoryItem["status"], tx?: Hex) {
    const h = this.s.history.find((x) => x.id === id);
    if (h && h.status !== "queued") {
      h.status = status;
      if (tx) h.tx = tx;
    }
  }

  private refreshWithdrawHistory() {
    for (const h of this.s.history.filter((x) => x.kind === "withdraw")) {
      const ws = this.s.withdrawals.filter((w) => w.historyId === h.id);
      if (!ws.length) continue;
      const sent = ws.filter((w) => w.status === "sent").length;
      h.status = sent === ws.length ? "confirmed" : "queued";
      h.detail = sent === ws.length ? `${ws.length} pieces sent` : `${sent}/${ws.length} sent`;
    }
  }

  // ------------------------------------------------------------------ deposit
  /** Allocates a one-time C-Chain address and precommitments for a deposit of `gross`. */
  /** Next one-time deposit address, without consuming it (for display before the user commits). */
  /**
   * Moves the next one-time deposit address past addresses that were already used. Wallet state
   * starts empty on a new device, and the deposit-address counter cannot be rebuilt from pool
   * events (deposits do not reveal their C-Chain address), so callers ask an outside source, e.g.
   * the relayer. Reusing an address would link the two deposits publicly.
   */
  async skipUsedDepositAddresses(isUsed: (address: Address) => Promise<boolean>, max = 50): Promise<Address> {
    let moved = false;
    for (let i = 0; i < max && (await isUsed(this.peekDepositAddress())); i++) {
      this.s.nextDepositAddress++;
      moved = true;
    }
    if (moved) await this.save();
    return this.peekDepositAddress();
  }

  peekDepositAddress(): Address {
    return depositAccount(this.keys, this.s.nextDepositAddress).address;
  }

  /**
   * Deposits whose pieces have not all reached the pool, newest first. The app uses this to
   * resume a deposit after a reload and to re-sign one the relayer reported failed or expired.
   */
  pendingDeposits(maxAgeSecs = 8 * 24 * 3600): PendingDeposit[] {
    const t = now();
    return this.s.deposits
      .filter((d) => d.confirmedPieces < d.pieces.length && t - d.createdAt <= maxAgeSecs)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((d) => ({ address: d.address, addressIndex: d.addressIndex, gross: d.gross, pieces: d.pieces, createdAt: d.createdAt, confirmedPieces: d.confirmedPieces }));
  }

  /** Key of a one-time deposit address (null for deposits from the user's own wallet: index -1). */
  depositSigner(addressIndex: number) {
    return addressIndex >= 0 ? depositAccount(this.keys, addressIndex) : null;
  }

  /** Next fresh exit addresses, without consuming them (for the withdrawal plan preview). */
  peekExitAddresses(n: number): Address[] {
    return Array.from({ length: n }, (_, i) => exitAccount(this.keys, this.s.nextExitAddress + i).address);
  }

  /**
   * Allocates precommitments for a deposit of `gross`. By default the deposit comes from a fresh
   * one-time address; pass `from` to deposit from the user's own wallet instead.
   */
  async planDeposit(gross: bigint, from?: Address) {
    const pieces = greedySplit(gross);
    const addressIndex = from ? -1 : this.s.nextDepositAddress++;
    const account = from ? null : depositAccount(this.keys, addressIndex);
    const owner = from ?? account!.address;
    const planned = planDepositPieces(this.keys, pieces, this.s.nextBlindingIndex);
    this.s.nextBlindingIndex += pieces.length;
    this.indexPrecommits();
    const historyId = newId();
    this.s.deposits.push({ address: owner, addressIndex, gross, pieces: planned, createdAt: now(), confirmedPieces: 0, historyId });
    this.s.history.push({
      id: historyId,
      kind: "deposit",
      amount: planned.reduce((a, p) => a + (p.denomination - (p.denomination * 25n) / 10_000n), 0n),
      counterparty: from ? `${shortAddress(owner, 6, 4)} (your wallet)` : `${shortAddress(owner, 6, 4)} (one-time)`,
      isPrivate: false,
      status: "pending",
      time: now(),
      pieces: pieces.length,
      detail: "waiting for USDC",
    });
    await this.save();
    return { account, owner, pieces: planned, addressIndex };
  }

  // ------------------------------------------------------------------ spending helpers
  private spendInput(n: OwnedNote): SpendInput {
    return { amount: n.amount, blinding: n.blinding, leafIndex: n.leafIndex, path: this.tree.path(n.leafIndex) };
  }

  private dummy(): { input: SpendInput; nullifier: bigint } {
    const b = randomField();
    const c = commitmentOf({ amount: 0n, owner: this.keys.owner, blinding: b });
    return { input: dummyInput(b), nullifier: nullifierOf(c, this.keys.sk, 0) };
  }

  /** Up to two notes covering `target`, preferring the smallest sufficient set. */
  selectInputs(target: bigint): OwnedNote[] | null {
    const notes = this.spendable().sort((a, b) => (a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0));
    const single = notes.find((n) => n.amount >= target);
    if (single) return [single];
    for (let i = notes.length - 1; i >= 1; i--) {
      // largest note + the smallest partner that suffices
      const big = notes[i];
      const partner = notes.slice(0, i).find((n) => big.amount + n.amount >= target);
      if (partner) return [big, partner];
    }
    return null;
  }

  /** How many 2→1 merges are needed before `target` fits in two inputs (each merge costs a send fee). */
  mergesNeeded(target: bigint): number | null {
    let amounts = this.spendable().map((n) => n.amount).sort((a, b) => (a > b ? -1 : 1));
    let merges = 0;
    const fits = () => amounts.length > 0 && (amounts[0] >= target || (amounts.length > 1 && amounts[0] + amounts[1] >= target));
    while (!fits()) {
      if (amounts.length < 3) return null;
      const merged = amounts[0] + amounts[1] - SEND_FEE;
      amounts = [merged, ...amounts.slice(2)].sort((a, b) => (a > b ? -1 : 1));
      merges++;
    }
    return merges;
  }

  private ins2(target: bigint): { notes: OwnedNote[]; inputs: [SpendInput, SpendInput]; nullifiers: [bigint, bigint] } {
    const notes = this.selectInputs(target);
    if (!notes) throw new Error("insufficient notes (merge first)");
    const a = this.spendInput(notes[0]);
    if (notes.length === 2) return { notes, inputs: [a, this.spendInput(notes[1])], nullifiers: [notes[0].nullifier, notes[1].nullifier] };
    const d = this.dummy();
    return { notes, inputs: [a, d.input], nullifiers: [notes[0].nullifier, d.nullifier] };
  }

  // ------------------------------------------------------------------ transfer
  async prepareTransfer(opts: { to: string; amount: bigint; ctx: Context; prover: Prover; kind?: "send" | "merge" }): Promise<PreparedTx<TransferPublic>> {
    const kind = opts.kind ?? "send";
    const recipient = decodeAddress(opts.to.trim());
    const { notes, inputs, nullifiers } = this.ins2(opts.amount + SEND_FEE);
    const total = notes.reduce((a, n) => a + n.amount, 0n);
    const out0: Note = { amount: opts.amount, owner: recipient.owner, blinding: randomField() };
    const out1: Note = { amount: total - opts.amount - SEND_FEE, owner: this.keys.owner, blinding: randomField() };
    const e0 = encryptNote(out0, recipient.viewPub);
    const e1 = encryptNote(out1, this.keys.viewPub);
    const notesData: [NoteDataHex, NoteDataHex] = [noteData(e0.ciphertext, e0.viewTag), noteData(e1.ciphertext, e1.viewTag)];
    const pub: TransferPublic = {
      root: this.tree.root,
      nullifiers,
      commitments: [commitmentOf(out0), commitmentOf(out1)],
      fee: SEND_FEE,
      relayer: opts.ctx.relayer,
      notes: notesData,
    };
    const proof = await opts.prover.prove("transfer", transferInputs(this.keys.sk, inputs, [out0, out1], pub, opts.ctx));
    const historyId = newId();
    const self = recipient.owner === this.keys.owner;
    this.expected.set(pub.commitments[1].toString(), { source: "change", historyId });
    if (self) this.expected.set(pub.commitments[0].toString(), { source: kind === "merge" ? "change" : "receive", historyId });
    this.s.history.push({
      id: historyId,
      kind: self && kind === "merge" ? "merge" : "send",
      amount: self ? -SEND_FEE : -(opts.amount + SEND_FEE),
      counterparty: shortAddress(opts.to, 7, 4),
      isPrivate: true,
      status: "pending",
      time: now(),
    });
    return { kind: "transfer", proof, args: pub, spent: notes.map((n) => n.nullifier), historyId };
  }

  /** Merge the two largest spendable notes into one (self-transfer), to fit a 2-input spend. */
  async prepareMerge(opts: { ctx: Context; prover: Prover }) {
    const notes = this.spendable().sort((a, b) => (a.amount > b.amount ? -1 : 1));
    if (notes.length < 2) throw new Error("nothing to merge");
    const amount = notes[0].amount + notes[1].amount - SEND_FEE;
    return this.prepareTransfer({ to: this.address, amount, ctx: opts.ctx, prover: opts.prover, kind: "merge" });
  }

  // ------------------------------------------------------------------ split + withdraw
  async prepareSplit(opts: { gross: bigint; ctx: Context; prover: Prover }): Promise<PreparedTx<SplitPublic> & { pieces: bigint[] }> {
    const pieces = greedySplit(opts.gross);
    if (pieces.length === 0 || pieces.length > MAX_PIECES) throw new Error(`need 1..${MAX_PIECES} pieces, got ${pieces.length}`);
    const { notes, inputs, nullifiers } = this.ins2(opts.gross + SEND_FEE);
    const total = notes.reduce((a, n) => a + n.amount, 0n);
    const denoms = pieces.map((amount) => ({ amount, blinding: randomField() }));
    const change: Note = { amount: total - opts.gross - SEND_FEE, owner: this.keys.owner, blinding: randomField() };
    const denomCommitments = Array.from({ length: MAX_PIECES }, (_, i) =>
      denoms[i] ? commitmentOf({ amount: denoms[i].amount, owner: this.keys.owner, blinding: denoms[i].blinding }) : 0n,
    );
    const notesData: NoteDataHex[] = Array.from({ length: MAX_PIECES }, (_, i) => {
      if (!denoms[i]) return EMPTY_NOTE;
      const e = encryptNote({ amount: denoms[i].amount, owner: this.keys.owner, blinding: denoms[i].blinding }, this.keys.viewPub);
      return noteData(e.ciphertext, e.viewTag);
    });
    const ec = encryptNote(change, this.keys.viewPub);
    notesData.push(noteData(ec.ciphertext, ec.viewTag));
    const pub: SplitPublic = {
      root: this.tree.root,
      nullifiers,
      denomCommitments,
      changeCommitment: commitmentOf(change),
      fee: SEND_FEE,
      relayer: opts.ctx.relayer,
      notes: notesData,
    };
    const proof = await opts.prover.prove("split", splitInputs(this.keys.sk, inputs, denoms, change, pub, opts.ctx));
    const historyId = newId();
    for (const c of denomCommitments) if (c) this.expected.set(c.toString(), { source: "split", historyId });
    this.expected.set(pub.changeCommitment.toString(), { source: "change", historyId });
    this.s.history.push({ id: historyId, kind: "split", amount: -SEND_FEE, isPrivate: true, status: "pending", time: now(), pieces: pieces.length, detail: "prepare pieces" });
    return { kind: "split", proof, args: pub, spent: notes.map((n) => n.nullifier), historyId, pieces };
  }

  /** Unspent denomination notes created by split, available for withdrawal. */
  withdrawablePieces(): OwnedNote[] {
    const queued = new Set(this.s.withdrawals.map((w) => w.nullifier.toString()));
    return this.spendable().filter((n) => n.source === "split" && DENOMINATIONS.includes(n.amount as never) && !queued.has(n.nullifier.toString()));
  }

  /** One withdraw proof per piece, each to a fresh exit address, for the batches the client chose. */
  async prepareWithdrawals(opts: { pieces: OwnedNote[]; batches: number[]; ctx: Context; prover: Prover; recipients?: Address[]; destination?: WithdrawDestination | null }) {
    const dest = opts.destination ?? null;
    const historyId = newId();
    const out: { batch: number; proof: ProofResult; args: WithdrawPublic }[] = [];
    let gross = 0n;
    for (let i = 0; i < opts.pieces.length; i++) {
      const n = opts.pieces[i];
      const recipient = opts.recipients?.[i] ?? exitAccount(this.keys, this.s.nextExitAddress++).address;
      const pub: WithdrawPublic = {
        root: this.tree.root,
        nullifier: n.nullifier,
        amount: n.amount,
        recipient,
        relayer: opts.ctx.relayer,
        destBlockchainId: dest ? dest.blockchainId : ZERO32,
        destTransferrer: dest ? dest.tokenRemote : ZERO_ADDRESS,
      };
      const proof = await opts.prover.prove("withdraw", withdrawInputs(this.keys.sk, this.spendInput(n), pub, opts.ctx));
      out.push({ batch: opts.batches[i], proof, args: pub });
      this.s.withdrawals.push({ nullifier: n.nullifier, denomination: n.amount, recipient, ...(dest ? { destination: dest.name } : {}), batch: opts.batches[i], status: "queued", historyId });
      gross += n.amount;
    }
    this.s.pendingSpent.push(...opts.pieces.map((p) => p.nullifier));
    this.s.history.push({
      id: historyId,
      kind: "withdraw",
      amount: -gross,
      counterparty: `${opts.pieces.length} fresh addresses${dest ? ` on ${dest.name}` : ""}`,
      isPrivate: false,
      status: "queued",
      time: now(),
      pieces: opts.pieces.length,
      detail: `0/${opts.pieces.length} sent`,
    });
    await this.save();
    return out;
  }

  /** Call after the relayer accepted a transfer/split. */
  async markSubmitted(tx: PreparedTx<unknown>, txHash?: Hex) {
    this.s.pendingSpent.push(...tx.spent);
    const h = this.s.history.find((x) => x.id === tx.historyId);
    if (h && txHash) h.tx = txHash;
    await this.save();
  }

  async markFailed(tx: PreparedTx<unknown>, reason: string) {
    const h = this.s.history.find((x) => x.id === tx.historyId);
    if (h) {
      h.status = "failed";
      h.detail = reason;
    }
    this.s.pendingSpent = this.s.pendingSpent.filter((x) => !tx.spent.includes(x));
    await this.save();
  }

  withdrawals(): Readonly<WithdrawalPiece[]> {
    return this.s.withdrawals;
  }
}
