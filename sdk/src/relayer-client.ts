import type { Address, Hex } from "viem";
import type { NoteDataHex, SplitPublic, TransferPublic, WithdrawPublic } from "./prover/inputs.js";
import type { SignedDeposit } from "./deposit.js";

const j = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

export interface RelayerInfo {
  relayer: Address;
  chainId: number;
  pool: Address;
  sendFee: string;
  feeBps: number;
  batchIntervalSecs: number;
  nextBatch: number;
  version: string;
  /** L1 withdraw destinations besides C-Chain, from the C-Chain DestinationRegistry (SPEC §14) */
  destinations?: { blockchainId: Hex; tokenRemote: Address; evmChainId: number; name: string }[];
}

export interface ScheduledPiece {
  batch: number;
  proof: Hex;
  args: WithdrawPublic;
}

export class RelayerError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export class RelayerClient {
  constructor(public url: string) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: j(body) });
    const txt = await r.text();
    const data = txt ? JSON.parse(txt) : {};
    if (!r.ok) throw new RelayerError(r.status, data?.error?.code ?? "http_error", data?.error?.message ?? txt);
    return data as T;
  }

  async info(): Promise<RelayerInfo> {
    const r = await fetch(`${this.url}/v1/info`);
    if (!r.ok) throw new RelayerError(r.status, "http_error", await r.text());
    return r.json();
  }

  transfer(proof: Hex, args: TransferPublic) {
    return this.post<{ txHash: Hex }>("/v1/transfer", { proof, args });
  }

  split(proof: Hex, args: SplitPublic) {
    return this.post<{ txHash: Hex }>("/v1/split", { proof, args });
  }

  withdraw(proof: Hex, args: WithdrawPublic) {
    return this.post<{ txHash: Hex }>("/v1/withdraw", { proof, args });
  }

  schedule(pieces: ScheduledPiece[]) {
    return this.post<{ ids: string[] }>("/v1/withdraw/schedule", { pieces });
  }

  registerDeposit(d: SignedDeposit) {
    return this.post<{ id: string; address: Address }>("/v1/deposit-address", d);
  }

  async depositStatus(address: Address) {
    const r = await fetch(`${this.url}/v1/deposit-address/${address}`);
    if (r.status === 404) return null;
    return r.json() as Promise<{ status: string; tx?: Hex | null; error?: string | null; gross?: string; balance?: string }>;
  }

  async scheduleStatus() {
    const r = await fetch(`${this.url}/v1/withdraw/schedule`);
    return r.json() as Promise<{ pending: number; nextBatch: number }>;
  }
}

export type { NoteDataHex };
