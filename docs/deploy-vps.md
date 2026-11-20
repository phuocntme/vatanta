# Moving from this machine to the VPS

Starting point: `docs/fuji-local.md` works — the L1 on Fuji, its validator node and every Docker
service on your machine. Contracts do **not** move: the same `contracts/deployments/fuji.json` keeps
working. What moves is the validator node and the containers.

## 1. VPS

- 4 vCPU / 8 GB RAM / 100 GB SSD, Ubuntu 24.04, Docker Engine + compose v2, Foundry (`cast`).
- `ulimit -n` ≥ 32768 for avalanchego (`LimitNOFILE=65536` in its systemd unit).
- Open port 9651/tcp (staking, peer-to-peer). Keep 9650 (RPC) closed to the internet; the web app
  reaches the L1 RPC through the tunnel below.

## 2. Validator: add on the VPS, then remove the one on your machine

A validator is a node identity, not a container, so it does not come over with `docker compose`.

1. On the VPS run avalanchego ≥ 1.15 with the matching Subnet-EVM plugin, tracking the L1
   (`--track-subnets=<subnetID>`), and let it sync Fuji's P-Chain.
2. From the machine that holds the PoA validator-manager owner key:
   `avalanche blockchain addValidator $L1_NAME --fuji --node-endpoint http://<vps>:9650 --weight 20 --balance 0.05`
3. Wait until the VPS validator is active and the L1 keeps producing blocks, then
   `avalanche blockchain removeValidator $L1_NAME --fuji` for your machine's node, and stop it.
   Until then keep your machine on: with one validator, the L1 stops when it sleeps.

Each active validator costs ≈ 0.044 AVAX/day; top up with `l1/fuji/topup.sh`.

## 3. Files to copy (never commit them)

```sh
git clone https://github.com/phuocntme/vatanta && cd vatanta
scp <local-host>:vatanta/.env .                                   # keys
scp <local-host>:vatanta/contracts/deployments/fuji.json contracts/deployments/
scp <local-host>:~/.avalanche-cli/…/icm-relayer-config.json /tmp/  # source of the icm-relayer config
```

## 4. `.env` changes for the VPS

| Variable | Local | VPS |
|---|---|---|
| `L1_RPC` | `http://127.0.0.1:9650/ext/bc/<id>/rpc` | `http://172.17.0.1:9650/ext/bc/<id>/rpc` (containers → node on the host by IP; start avalanchego with `--http-host=0.0.0.0`, firewall 9650 from outside) |
| `PUBLIC_L1_RPC` | = `L1_RPC` | `https://rpc.<domain>/ext/bc/<id>/rpc` |
| `PUBLIC_RELAYER_URL` | `http://127.0.0.1:8090` | `https://relayer.<domain>` |
| `PUBLIC_INDEXER_URL` | `http://127.0.0.1:8091` | `https://indexer.<domain>` |
| `POSTGRES_PASSWORD` | generated in `.run/` | a strong value |
| `CLOUDFLARE_TUNNEL_TOKEN` | — | token of the tunnel below |
| `BATCH_INTERVAL_SECS` | 600 | 600 (locked) |

`NEXT_PUBLIC_*` values are baked into the web image at build time: change them, then rebuild
(`--build`). Add `https://app.<domain>` to the allowed origins in the Privy dashboard.

## 5. Cloudflare Tunnel routes

| Hostname | Service (compose network) |
|---|---|
| `app.<domain>` | `http://web:4001` |
| `relayer.<domain>` | `http://relayer:8080` |
| `indexer.<domain>` | `http://indexer:8081` |
| `rpc.<domain>` | `http://172.17.0.1:9650` (the node on the host) |

avalanchego answers `403 invalid host specified` to Host names it does not know, so start it with
`--http-allowed-hosts=rpc.<domain>` (containers use the IP, which is always accepted).

## 6. Start

```sh
HOST_IP=172.17.0.1 ICM_RELAYER_SOURCE=/tmp/icm-relayer-config.json l1/fuji/icm-relayer-config.sh
docker compose --profile icm --profile tunnel up -d --build     # reads .env
curl -fsS https://relayer.<domain>/v1/info && curl -fsS https://indexer.<domain>/v1/stats
```

Stop the containers on your machine (`scripts/fuji-local.sh down`) **before** starting the VPS
stack: the relayer and icm-relayer keys must only be used by one host at a time.

## 7. Data

- Indexer: nothing to copy. It rebuilds from the chain starting at `l1StartBlock` in `fuji.json`.
- Relayer: copy it if withdrawals are still queued or deposits still waiting
  (`docker compose exec postgres pg_dump -U vatanta vatanta_relayer > relayer.sql` on your machine,
  `psql` it into the VPS postgres before starting the relayer). Otherwise start empty.

## Checklist

- [ ] VPS validator active, your machine's validator removed, L1 producing blocks
- [ ] `.env` updated, `fuji.json` and icm-relayer config in place
- [ ] Containers on your machine stopped
- [ ] `docker compose … up -d --build` healthy; tunnel hostnames answer
- [ ] Privy origin added; deposit → send → withdraw once on the live URL
