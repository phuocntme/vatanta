# Vatanta on Fuji, services on this machine

The chain side is real Fuji: contracts on the Fuji C-Chain, the Vatanta L1 on Fuji with its validator
node running on this machine. Every off-chain service (postgres, relayer, indexer, web, icm-relayer)
runs in Docker exactly as it will on the VPS. Moving to the VPS later is `docs/deploy-vps.md`.

```
Fuji C-Chain (public RPC)          this machine
  USDC (Circle) · TokenHome          avalanchego 1.15 + Subnet-EVM  ← validator of the Vatanta L1 (Fuji)
  DepositRouter                      docker: postgres · relayer :8090 · indexer :8091 · web :4001 · icm-relayer
```

## 0. Requirements

- Docker Desktop (or Docker Engine + compose v2), Foundry (`cast`), Python 3, `curl`, `openssl`.
- avalanche-cli 1.9.7 and **avalanchego ≥ 1.15 with a matching Subnet-EVM**. Fuji activated the
  Helicon upgrade on 2026-07-28; avalanche-cli 1.9.7 still installs avalanchego 1.14, which cannot
  join Fuji. Use the official ava-labs release binaries (check the SHA-256 against the release page)
  for the node.
- The public Fuji API no longer serves some P-Chain calls avalanche-cli uses (balances), so point
  avalanche-cli at the Fuji node on this machine once it has synced the P-Chain.
- Open-file limit ≥ 32768 for avalanchego (`ulimit -n 32768`).

## 1. Fill `.env`

```sh
cp .env.example .env
```

| Variable | Value |
|---|---|
| `DEPLOYER_PK` | funded Fuji key (C-Chain AVAX for deploys) |
| `RELAYER_PK` | relayer hot key; fill **before** `up.sh` so it gets L1 gas (VNT) at genesis. ≥ 0.01 AVAX on C-Chain |
| `L1_NAME` | `vatantafuji` |
| `C_RPC` | `https://api.avax-test.network/ext/bc/C/rpc` |
| `L1_RPC` | the L1 RPC on this machine, e.g. `http://127.0.0.1:9650/ext/bc/<blockchainID-cb58>/rpc` (printed by `up.sh` / `avalanche blockchain describe`) |
| `C_ICM_REGISTRY` | prefilled (verified) |
| `L1_ICM_REGISTRY` | "ICM Registry Address" of the L1 from `avalanche blockchain describe` |
| `USDC` | Circle Fuji USDC, prefilled |
| `PRIVY_APP_ID` | optional; allow `http://localhost:4001` in the Privy dashboard |
| `ICM_RELAYER_VERSION` | `v1.8.4` (≥ v1.8 for Fuji after Helicon) |

Leave `POSTGRES_PASSWORD=change-me`: a random one is generated once and kept in `.run/`.

## 2. Create the L1 (once)

```sh
l1/fuji/up.sh            # L1 + validator on this machine + ICM relayer config (l1/fuji/README.md)
```

The validator fee runs from the moment the validator is registered (≈ 0.044 AVAX/day). Top it up
with `l1/fuji/topup.sh`. When this machine sleeps, the L1 stops producing blocks; state is kept.

### What actually worked (2026-11-18, avalanche-cli 1.9.7)

`up.sh` with `--use-local-machine` cannot finish on today's Fuji: avalanche-cli installs
avalanchego 1.14 (Fuji runs 1.15.3) and needs `platform.getBalance`, which the public API dropped.
The L1 `vatantafuji` (subnet `YCnBKe5E…`, blockchain `26kFwsc6…`) was created like this:

1. avalanchego **1.15.3** + Subnet-EVM **1.15.3** (ava-labs release zips, SHA-256 checked) in
   `~/.avalanche-cli/bin/{avalanchego,subnet-evm}/…-v1.15.3`; the L1 sidecar set to
   `VMVersion v1.15.3`, `RPCVersion 47`.
2. Own Fuji node, P-Chain partial sync, in `~/.avalanchego-vatanta-fuji` (`start.sh` there; the
   Subnet-EVM binary is copied to `plugins/<VM ID>`; chain config without admin/debug APIs because
   the node listens on 0.0.0.0 for Docker). P-Chain sync took ≈ 15 min.
3. `l1/fuji/endpoint-proxy.py` on :9640: public Fuji API, except `/ext/info` and the P-Chain calls
   the public API refuses, which go to the own node.
4. `avalanche blockchain deploy vatantafuji --fuji --key vatanta-fuji --balance 0.05
   --bootstrap-endpoints http://127.0.0.1:9650 --endpoint http://127.0.0.1:9640
   --change-owner-address <P-fuji…> --vmc-L1` (no prompts; never answer the subnet/blockchain-ID
   prompts of `blockchain convert` by script: a subnet ID typed as the blockchain ID makes an L1
   whose Validator Manager can never be initialized).
5. Restart the node with `--track-subnets=<subnet ID>`, then
   `avalanche contract initValidatorManager vatantafuji --fuji --endpoint …:9640 --rpc <L1 RPC>`,
   `avalanche icm deploy --blockchain vatantafuji --fuji --version v1.0.0 …`,
   `avalanche interchain relayer deploy … --key cli-awm-relayer --log-level info` (only to generate
   and fund the relayer config; `icm-relayer-config.sh` turns it into the Docker one).
6. `contracts/script/deploy.sh "$PWD/.env"` (absolute path). It deploys everything but times out
   waiting for the TokenRemote registration because no relayer runs yet; `fuji.json` was then
   written by hand with the same fields, and after `scripts/fuji-local.sh up` the registration was
   re-sent with `cast send <tokenRemote> "registerWithHome((address,uint256))" "(0x0…0,0)"`.

## 3. Start everything

```sh
scripts/fuji-local.sh up
```

What it does:

1. **Preflight**: Docker running; C_RPC is Fuji (43113); L1_RPC answers; the relayer has AVAX on
   C-Chain and VNT on the L1; an existing `contracts/deployments/fuji.json` matches this L1.
2. **Deploy** contracts with `contracts/script/deploy.sh .env` if `fuji.json` is missing.
3. `l1/fuji/docker-env.sh` → `.run/fuji-local.env` (containers reach the node through the host IP,
   because avalanchego rejects host names such as `host.docker.internal`).
4. `l1/fuji/icm-relayer-config.sh` → `l1/fuji/icm-relayer.json` from the config avalanche-cli
   generated (endpoints rewritten for Docker, `vm` fields dropped for icm-relayer ≥ 1.7.5). Contains
   keys: gitignored, mode 600. If an icm-relayer started by avalanche-cli is still running, stop it
   first (`avalanche interchain relayer stop --fuji`) — two relayers with one key fight over nonces.
5. `docker compose --env-file .run/fuji-local.env --profile icm up -d --build`, then health checks.

Open <http://localhost:4001>. Test USDC: <https://faucet.circle.com> → Avalanche Fuji → paste the
one-time deposit address the app shows (the deposit screen links to it).

| Command | |
|---|---|
| `scripts/fuji-local.sh status` | containers, relayer `/v1/info`, indexer stats, relayer balances |
| `scripts/fuji-local.sh logs [relayer\|indexer\|web\|icm-relayer\|postgres]` | follow logs |
| `scripts/fuji-local.sh down` | stop; database volumes stay |
| `ICM=external scripts/fuji-local.sh up` | don't start the Docker icm-relayer (one runs elsewhere) |
| `SKIP_BUILD=1 scripts/fuji-local.sh up` | restart without rebuilding images |

## 4. Check it end to end

```sh
pnpm fuji:smoke      # deposit 20 → send 5 → split 10 → withdraw in the next batch (≤ 10 min)
```

The funder (`FUNDER_PK`, default `DEPLOYER_PK`) must hold ≥ 20 Circle test USDC. Simulated traffic for
the privacy meter: `SIM_FUNDER_PK=<key with USDC> NETWORK=fuji RELAYER_URL=http://127.0.0.1:8090
INDEXER_URL=http://127.0.0.1:8091 pnpm simulate 4 2` (20 USDC per simulated user).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `L1_RPC … does not answer` | node not running or not synced; with Docker Desktop the node may stay on 127.0.0.1. On Linux the node must listen on the docker0 address (`--http-host=0.0.0.0`) |
| `403 invalid host specified` in relayer/indexer logs | something uses a host name for the node; set `HOST_IP` to an IP and rerun `up` |
| `relayer … has no VNT on the L1` | `RELAYER_PK` was empty during `up.sh`; send VNT from the deployer (command is printed) |
| Deposits stay "waiting" after USDC arrived | relayer C-Chain AVAX too low (`status`), or the relayer logs show RPC errors: they are retried with backoff up to 8 times |
| Withdrawals or deposits never reach the other chain | icm-relayer: `logs icm-relayer`; check `ICM_RELAYER_VERSION` and that only one icm-relayer runs |
| Web shows "No deployment found" | `contracts/deployments/fuji.json` missing when the image was built; rerun `up` |
