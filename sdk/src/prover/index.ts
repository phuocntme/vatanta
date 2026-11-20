import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec-foundation/bb.js";
import { bytesToHex, hexToBytes } from "../keys.js";

export type CircuitName = "transfer" | "split" | "withdraw";

export interface CircuitMeta {
  name: CircuitName;
  gates: number;
  acirOpcodes: number;
  publicInputs: number;
  vkHash: string;
}

export interface ProofResult {
  circuit: CircuitName;
  proof: `0x${string}`;
  publicInputs: string[];
  provingMs: number;
  witnessMs: number;
  proofBytes: number;
  meta?: CircuitMeta;
}

export interface Artifacts {
  circuits: Record<CircuitName, CompiledCircuit>;
  meta?: Partial<Record<CircuitName, CircuitMeta>>;
}

/** What the wallet needs from a prover (the browser passes a Web Worker proxy). */
export interface ProverLike {
  prove(name: CircuitName, inputs: Record<string, unknown>): Promise<ProofResult>;
  verify?(name: CircuitName, proof: `0x${string}`, publicInputs: string[]): Promise<boolean>;
}

/** Wraps noir_js (witness) + bb.js UltraHonk (proof, keccak/EVM target). One instance per worker. */
export class Prover implements ProverLike {
  private api?: Barretenberg;
  private backends = new Map<CircuitName, UltraHonkBackend>();
  private noirs = new Map<CircuitName, Noir>();

  constructor(private artifacts: Artifacts, private opts: { threads?: number; srsSize?: number } = {}) {}

  private async init() {
    // Our circuits are < 2^14 gates; bb.js accepts CRS chunks of 2^17 points (4 MB compressed),
    // a quarter of its 2^19 default. Makes the first browser proof fast (then cached in IndexedDB).
    if (!this.api) this.api = await Barretenberg.new({ threads: this.opts.threads, srsSize: this.opts.srsSize ?? 2 ** 17 });
    return this.api;
  }

  private async get(name: CircuitName) {
    const api = await this.init();
    if (!this.backends.has(name)) {
      const c = this.artifacts.circuits[name];
      this.noirs.set(name, new Noir(c));
      this.backends.set(name, new UltraHonkBackend(c.bytecode, api));
    }
    return { noir: this.noirs.get(name)!, backend: this.backends.get(name)! };
  }

  async prove(name: CircuitName, inputs: Record<string, unknown>): Promise<ProofResult> {
    const { noir, backend } = await this.get(name);
    const t0 = performance.now();
    const { witness } = await noir.execute(inputs as never);
    const t1 = performance.now();
    const { proof, publicInputs } = await backend.generateProof(witness, { verifierTarget: "evm" });
    const t2 = performance.now();
    return {
      circuit: name,
      proof: bytesToHex(proof),
      publicInputs,
      witnessMs: Math.round(t1 - t0),
      provingMs: Math.round(t2 - t1),
      proofBytes: proof.length,
      meta: this.artifacts.meta?.[name],
    };
  }

  /** Loads WASM, downloads the CRS and builds the proving keys up front (call after unlock). */
  async warmup(names: CircuitName[] = ["transfer", "split", "withdraw"]): Promise<void> {
    for (const n of names) {
      const { backend } = await this.get(n);
      await backend.getVerificationKey({ verifierTarget: "evm" });
    }
  }

  /** Off-chain verification (used by the Proof inspector "Verify locally" button). */
  async verify(name: CircuitName, proof: `0x${string}`, publicInputs: string[]): Promise<boolean> {
    const { backend } = await this.get(name);
    const bytes = hexToBytes(proof);
    return backend.verifyProof({ proof: bytes, publicInputs }, { verifierTarget: "evm" });
  }

  async destroy() {
    await this.api?.destroy();
    this.api = undefined;
    this.backends.clear();
  }
}
