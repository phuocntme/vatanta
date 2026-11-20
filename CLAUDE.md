# CLAUDE.md — Vatanta monorepo

Shielded USDC pool on an Avalanche L1. **Read `SPEC.md` first** — it is the source of truth and
records every design decision.

## Toolchain (pinned; see SPEC.md §10)

Binaries live in `~/.local/toolchain/{nargo,bb,avalanche}` (installed from official GitHub
releases; `curl | sh` installers are blocked here). Add them to `PATH`:

```sh
export PATH="$HOME/.local/toolchain/nargo:$HOME/.local/toolchain/bb:$HOME/.local/toolchain/avalanche:$PATH"
```

nargo 1.0.0 · bb 6.0.0 (npm `@aztec-foundation/bb.js` 6.0.0, exact package pinned in `sdk/package.json`)
· avalanche-cli 1.9.7 · Foundry 1.8.3 · Rust stable · Node 24 · pnpm 12.

## Commands

| What | Command |
|---|---|
| Circuit tests | `nargo test --workspace --program-dir circuits` |
| Build circuits → VKs → Solidity verifiers → SDK artifacts | `circuits/build.sh` |
| Contract tests (unit + invariants + real proofs) | `cd contracts && forge test` |
| Regenerate real-proof fixtures (after circuit/contract changes) | `cd sdk && npx tsx scripts/gen-fixtures.ts` |
| SDK tests | `cd sdk && npx vitest run` |
| Rust tests | `cd services && cargo test` |
| Local Avalanche network (+ writes `l1/.local.env`) | `l1/local-up.sh` (`E2E_CLEAN=1` to wipe) |
| Deploy everything to it | `contracts/script/deploy.sh l1/.local.env` → `contracts/deployments/local.json` |
| Direct flow (no services) | `cd e2e && npx tsx src/flow-direct.ts` |
| **Full e2e** (network, deploy, relayer, indexer, real proofs) | `pnpm e2e` |
| Local demo stack (network + deploy + relayer + indexer + web on :4001) | `pnpm demo` |
| Browser e2e (headless Chromium, needs `pnpm demo`) | `pnpm e2e:web` |
| Traffic simulator (labelled simulated) | `pnpm simulate` |
| Fuji smoke test (deposit → send → split → withdraw on the live stack; funder needs ≥ 20 test USDC) | `pnpm fuji:smoke` |
| Fuji validator top-up (P-Chain) | `l1/fuji/topup.sh 0.05` |
| New router + pool (+ DestinationRegistry) on an existing deployment, same bridge and verifiers | `contracts/script/upgrade-pool.sh "$PWD/.env"` |
| Integrate an L1 as a withdraw destination (SPEC §14) | `DEST_NAME=Echo DEST_RPC=https://… contracts/script/add-destination.sh "$PWD/.env"`, then `l1/fuji/icm-relayer-config.sh` + restart icm-relayer |
| Re-emit ICM messages a tx sent while the icm-relayer was down | `cd e2e && RPC=… PK=… pnpm icm:retry <txHash>` |
| Production Docker stack on this machine ("local VPS", against the local network; stop `pnpm demo` first) | `l1/vps-local-env.sh && docker compose --env-file .run/vps-local.env up -d --build` → web :4001, relayer :8090, indexer :8091 |

## Layout

```
circuits/   Noir workspace: lib (hashes, Merkle, fixtures), transfer, split, withdraw; build.sh
contracts/  Foundry: ShieldedPool, DepositRouter, VerifierRegistry, RelayerRegistry, verifiers/ (generated)
l1/         local-up.sh, patch-genesis.py, genesis.json (reference), fuji/ (testnet plan + scripts)
services/   cargo workspace: common (poseidon2, merkle, bindings), relayer (axum), indexer (axum + Postgres)
sdk/        TypeScript SDK (source-only package, consumed via tsx / Next transpilePackages)
apps/web    Next.js app
apps/agent-demo  agent that pays through the relayer API (HTTP 402 flow)
e2e/        full-flow scripts on the local network
```

## Conventions

- Amounts are integer micro-USDC (`bigint` in TS, `U256` in Rust, `uint256` in Solidity). Never floats.
- Hash compatibility is sacred: Noir `circuits/lib`, `contracts/src/lib/Field.sol`,
  `sdk/src/crypto/poseidon2.ts`, `services/common/src/poseidon2.rs` must agree; vectors live in
  `sdk/test/vectors.json` and are checked in all four test suites.
- Public-input order is fixed by circuit parameter order and mirrored in `ShieldedPool.sol` and
  `sdk/src/prover/inputs.ts`. Changing a circuit ⇒ run `circuits/build.sh`, regenerate fixtures,
  rerun `forge test`.
- Generated verifiers in `contracts/src/verifiers/` are not edited by hand.
- Never mock the proof system in e2e. Unit tests may use `AcceptAllVerifier`; `RealProofs.t.sol`
  and everything under `e2e/` use real proofs.
- Never commit private keys. Local scripts use avalanche-cli's public "ewoq" test key only for the
  local network; Fuji keys come from `.env` (see `.env.example`).
- Locked parameters (SPEC.md §2) require explicit approval to change.
- Keep `SPEC.md` current when a decision changes.
- Commit in small, focused steps.
