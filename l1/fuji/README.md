# Vatanta L1 on Fuji — deployment prerequisites

Everything here is scripted; you only need to provide the keys, validator host, and endpoints below.

## You provide

| Item | Why | Where it goes |
|---|---|---|
| Funded Fuji key (≈ 3 AVAX on C-Chain, ≈ 2 AVAX on P-Chain) | L1 creation, validator registration fees, contract deployment | `avalanche key create vatanta-fuji` + faucet; `DEPLOYER_PK` in `.env` |
| Relayer hot key with a little AVAX | relayer calls `DepositRouter` on C-Chain | `RELAYER_PK` in `.env` |
| 1 validator machine (local machine for testing, later a VPS) | runs avalanchego + the L1 | `BOOTSTRAP_FLAGS` for `up.sh` |
| Public RPC endpoint for the L1 (domain) | web app + services | `L1_RPC`, `PUBLIC_L1_RPC` |
| Cloudflare Tunnel token (optional) | expose web / relayer / indexer from Coolify | `CLOUDFLARE_TUNNEL_TOKEN` |

## One command each

```sh
cp .env.example .env            # fill the blanks (RELAYER_PK before up.sh)
VALIDATOR_MANAGER_OWNER=0x… l1/fuji/up.sh
scripts/fuji-local.sh up        # deploys contracts if needed, then all services in Docker on this machine
```

Step by step: `docs/fuji-local.md`. Moving to a VPS: `docs/deploy-vps.md`.

## Budget: 0.5 testnet AVAX (measured on Fuji, 2026-11-17)

| Cost | Rate | Plan |
|---|---|---|
| L1 validator continuous fee (P-Chain) | 512 nAVAX/s ≈ **0.044 AVAX/day** per validator | 1 validator; start with `VALIDATOR_BALANCE=0.05` (≈ 1 day of testing), top up with `l1/fuji/topup.sh` before the demo |
| P-Chain txs (create subnet / chain / convert to L1, top-ups) | gas price 1 nAVAX → well under 0.001 AVAX each | — |
| C-Chain gas (contract deploys, relayer deposits, ICM delivery to C-Chain) | ~160 wei/gas today; ≈ 0.000002 AVAX for 10 M gas | keep 0.1 AVAX as a buffer against gas spikes |
| L1 gas (pool, verifiers, proofs) | paid in VNT, minted at genesis to deployer + relayer | free |

Split: send all 0.5 AVAX to the deployer's C-Chain address; keep ≈ 0.1 on C-Chain (deploys, relayer
0.02, ICM relayer 0.02), move ≈ 0.4 to P-Chain (validator fee). 0.4 AVAX ≈ 9 days of L1 uptime in total:
test for a day, let the validator go inactive (the L1 pauses, state is kept), then top up a few days
when needed. Each extra validator doubles the daily cost, so the demo runs 1 validator.

## Validator plan

- Local network: PoA, 1 validator (avalanche-cli default).
- Fuji demo: PoA with **3–5 validators** in different regions (e.g. Singapore, Frankfurt, Virginia),
  each a 4 vCPU / 8 GB VM running avalanchego with the Subnet-EVM plugin. The validator manager is
  owned by a team multisig. Add validators with
  `avalanche blockchain addValidator vatanta --fuji --node-endpoint https://<node>:9650 --weight 20`.
- Privacy does not depend on validators: they only see proofs, nullifiers, commitments and
  ciphertext. The L1 can therefore move to open (PoS) validation without design changes.

## Notes

- Fuji USDC (`0x5425…Bc65`) supports EIP-2612 permit (verified on-chain), so no mock is needed there.
- `C_ICM_REGISTRY` in `.env.example` (`0xF86C…B228`) was verified on Fuji on 2026-11-12: it has code,
  `latestVersion() = 1`, and version 1 points to the ICM messenger `0x253b…5fcf`. Fuji C-Chain
  blockchain ID (hex) `0x7fc93d85…c10d5`; `deploy.sh` reads it from the warp precompile anyway.
- The relayer's `FAUCET` must stay `0` on Fuji (it only works with `MockUSDC`).

- Running the Docker services against a node on the **same machine**: avalanchego rejects unknown
  Host names (`403 invalid host specified` for `host.docker.internal`) but accepts IP addresses, so
  containers call the node by IP (Docker Desktop host gateway `192.168.65.254`, or `172.17.0.1` on
  Linux). `l1/vps-local-env.sh` does this for the local network.
- The public Fuji P-Chain API no longer serves `platform.getBalance` (checked 2026-11-17), so
  `avalanche key list --fuji` fails; `getUTXOs` (used to build transactions) still works. If a CLI step
  needs balances, pass `--endpoint http://127.0.0.1:9650` once the local Fuji node has synced.
