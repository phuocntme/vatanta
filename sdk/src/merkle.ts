import { TREE_DEPTH } from "./constants.js";
import { hash2 } from "./crypto/poseidon2.js";

let ZEROS: bigint[] | null = null;
export function zeros(): bigint[] {
  if (!ZEROS) {
    ZEROS = [0n];
    for (let i = 1; i <= TREE_DEPTH; i++) ZEROS.push(hash2(ZEROS[i - 1], ZEROS[i - 1]));
  }
  return ZEROS;
}

/** Client-side copy of the pool's tree, rebuilt from leaves (indexer or on-chain events). */
export class MerkleTree {
  /** layers[0] = leaves, layers[d] = nodes at height d (only the non-empty prefix) */
  private layers: bigint[][] = Array.from({ length: TREE_DEPTH + 1 }, () => []);

  constructor(leaves: bigint[] = []) {
    if (leaves.length) this.insertMany(leaves);
  }

  get size(): number {
    return this.layers[0].length;
  }

  get root(): bigint {
    return this.layers[TREE_DEPTH][0] ?? zeros()[TREE_DEPTH];
  }

  leaf(i: number): bigint {
    return this.layers[0][i];
  }

  insert(leaf: bigint): number {
    return this.insertMany([leaf]);
  }

  /** Appends leaves; returns the first index. */
  insertMany(leaves: bigint[]): number {
    const start = this.size;
    if (!leaves.length) return start;
    this.layers[0].push(...leaves);
    let lo = start;
    let hi = this.size - 1;
    const z = zeros();
    for (let d = 0; d < TREE_DEPTH; d++) {
      const cur = this.layers[d];
      const up = this.layers[d + 1];
      for (let p = lo >> 1; p <= hi >> 1; p++) {
        const l = cur[2 * p];
        const r = 2 * p + 1 < cur.length ? cur[2 * p + 1] : z[d];
        up[p] = hash2(l, r);
      }
      lo >>= 1;
      hi >>= 1;
    }
    return start;
  }

  path(index: number): bigint[] {
    if (index >= this.size) throw new Error(`leaf ${index} not in tree (size ${this.size})`);
    const z = zeros();
    const out: bigint[] = [];
    let i = index;
    for (let d = 0; d < TREE_DEPTH; d++) {
      const sib = i ^ 1;
      out.push(sib < this.layers[d].length ? this.layers[d][sib] : z[d]);
      i >>= 1;
    }
    return out;
  }

  static rootFromPath(leaf: bigint, index: number, path: bigint[]): bigint {
    let node = leaf;
    for (let d = 0; d < TREE_DEPTH; d++) {
      node = (index >> d) & 1 ? hash2(path[d], node) : hash2(node, path[d]);
    }
    return node;
  }
}
