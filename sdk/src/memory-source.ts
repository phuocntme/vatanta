import type { DataSource, EventPage, PoolEvent } from "./events.js";
import { MerkleTree } from "./merkle.js";
import { commitmentFromPrecommit } from "./note.js";
import type { Hex } from "viem";

/**
 * In-memory stand-in for the pool's event stream, used by fixture generation and tests. It applies
 * the same state transitions as ShieldedPool (without verifying proofs) so roots match on-chain.
 */
export class MemorySource implements DataSource {
  events_: PoolEvent[] = [];
  tree = new MerkleTree();
  roots = new Set<string>([this.tree.root.toString()]);
  block = 1;
  time = 1_700_000_000;

  private tick() {
    return { block: this.block++, time: (this.time += 2), tx: `0x${this.block.toString(16).padStart(64, "0")}` as Hex };
  }

  private leaf(c: bigint) {
    const i = this.tree.insert(c);
    this.roots.add(this.tree.root.toString());
    return i;
  }

  deposit(amount: bigint, denomination: bigint, precommit: bigint) {
    const commitment = commitmentFromPrecommit(amount, precommit);
    const leafIndex = this.leaf(commitment);
    this.events_.push({ kind: "deposit", leafIndex, commitment, amount, denomination, precommit, ...this.tick() });
  }

  notes(items: { commitment: bigint; viewTag: number; ciphertext: Hex }[], nullifiers: bigint[]) {
    const t = this.tick();
    for (const n of nullifiers) this.events_.push({ kind: "nullifier", nullifier: n, ...t });
    for (const it of items) {
      const leafIndex = this.leaf(it.commitment);
      this.events_.push({ kind: "note", leafIndex, ...it, ...t });
    }
  }

  async events(from: number): Promise<EventPage> {
    return { events: this.events_.filter((e) => e.block >= from), cursor: this.block };
  }

  async isKnownRoot(root: bigint) {
    return this.roots.has(root.toString());
  }
}
