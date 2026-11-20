import { decodeEventLog, type Address, type Hex, type PublicClient } from "viem";
import { shieldedPoolAbi } from "./abi.js";

/** `destination` of a withdrawal to C-Chain */
const ZERO_DEST = `0x${"0".repeat(64)}` as Hex;

export type PoolEvent =
  | { kind: "deposit"; leafIndex: number; commitment: bigint; amount: bigint; denomination: bigint; precommit: bigint; block: number; time: number; tx: Hex }
  | { kind: "note"; leafIndex: number; commitment: bigint; viewTag: number; ciphertext: Hex; block: number; time: number; tx: Hex }
  | { kind: "nullifier"; nullifier: bigint; block: number; time: number; tx: Hex }
  | { kind: "withdrawal"; nullifier: bigint; denomination: bigint; recipient: Address; relayer: Address; fee: bigint; destination: Hex; block: number; time: number; tx: Hex };

export interface EventPage {
  events: PoolEvent[];
  /** next block to query from */
  cursor: number;
}

export interface DataSource {
  /** Events with block >= from, ordered by (block, logIndex). */
  events(from: number): Promise<EventPage>;
  /** Root check against the chain (independent of the data source). */
  isKnownRoot?(root: bigint): Promise<boolean>;
}

/** Reads pool logs straight from an L1 RPC (no indexer needed; slower for large histories). */
export class ChainSource implements DataSource {
  private times = new Map<bigint, number>();
  constructor(private client: PublicClient, private pool: Address, private startBlock = 0, private chunk = 2_000) {}

  async events(from: number): Promise<EventPage> {
    const head = Number(await this.client.getBlockNumber());
    const start = Math.max(from, this.startBlock);
    const out: PoolEvent[] = [];
    for (let a = start; a <= head; a += this.chunk) {
      const b = Math.min(head, a + this.chunk - 1);
      const logs = await this.client.getLogs({ address: this.pool, fromBlock: BigInt(a), toBlock: BigInt(b) });
      for (const log of logs) {
        let ev;
        try {
          ev = decodeEventLog({ abi: shieldedPoolAbi, data: log.data, topics: log.topics });
        } catch {
          continue;
        }
        const time = await this.blockTime(log.blockNumber!);
        const base = { block: Number(log.blockNumber), time, tx: log.transactionHash! };
        const x = ev.args as Record<string, unknown>;
        switch (ev.eventName) {
          case "Deposit":
            out.push({ kind: "deposit", leafIndex: Number(x.leafIndex), commitment: x.commitment as bigint, amount: x.amount as bigint, denomination: x.denomination as bigint, precommit: x.precommit as bigint, ...base });
            break;
          case "NoteCommitted":
            out.push({ kind: "note", leafIndex: Number(x.leafIndex), commitment: x.commitment as bigint, viewTag: Number(x.viewTag), ciphertext: x.ciphertext as Hex, ...base });
            break;
          case "NullifierSpent":
            out.push({ kind: "nullifier", nullifier: x.nullifier as bigint, ...base });
            break;
          case "Withdrawal":
            out.push({ kind: "withdrawal", nullifier: x.nullifier as bigint, denomination: x.denomination as bigint, recipient: x.recipient as Address, relayer: x.relayer as Address, fee: x.fee as bigint, destination: (x.destination as Hex) ?? ZERO_DEST, ...base });
            break;
        }
      }
    }
    return { events: out, cursor: head + 1 };
  }

  async isKnownRoot(root: bigint): Promise<boolean> {
    return this.client.readContract({ address: this.pool, abi: shieldedPoolAbi, functionName: "isKnownRoot", args: [root] });
  }

  private async blockTime(n: bigint): Promise<number> {
    if (!this.times.has(n)) {
      const b = await this.client.getBlock({ blockNumber: n });
      this.times.set(n, Number(b.timestamp));
    }
    return this.times.get(n)!;
  }
}

const big = (x: unknown) => BigInt(x as string);

/** Parses the indexer's JSON (bigints as decimal/hex strings) into PoolEvents. */
export function parseEvents(json: { events: Record<string, unknown>[]; cursor: number }): EventPage {
  const events = json.events.map((e): PoolEvent => {
    const base = { block: Number(e.block), time: Number(e.time), tx: e.tx as Hex };
    switch (e.kind) {
      case "deposit":
        return { kind: "deposit", leafIndex: Number(e.leafIndex), commitment: big(e.commitment), amount: big(e.amount), denomination: big(e.denomination), precommit: big(e.precommit), ...base };
      case "note":
        return { kind: "note", leafIndex: Number(e.leafIndex), commitment: big(e.commitment), viewTag: Number(e.viewTag), ciphertext: e.ciphertext as Hex, ...base };
      case "nullifier":
        return { kind: "nullifier", nullifier: big(e.nullifier), ...base };
      default:
        return { kind: "withdrawal", nullifier: big(e.nullifier), denomination: big(e.denomination), recipient: e.recipient as Address, relayer: e.relayer as Address, fee: big(e.fee), destination: ((e.destination as Hex) || ZERO_DEST), ...base };
    }
  });
  return { events, cursor: json.cursor };
}

/** Indexer-backed source; roots are still checked against the chain when a client is given. */
export class IndexerSource implements DataSource {
  constructor(private url: string, private chain?: ChainSource) {}

  async events(from: number): Promise<EventPage> {
    const r = await fetch(`${this.url}/v1/events?from=${from}`);
    if (!r.ok) throw new Error(`indexer ${r.status}`);
    return parseEvents(await r.json());
  }

  async isKnownRoot(root: bigint): Promise<boolean> {
    if (this.chain) return this.chain.isKnownRoot(root);
    const r = await fetch(`${this.url}/v1/root/${root.toString()}`);
    return r.ok && (await r.json()).known === true;
  }
}
