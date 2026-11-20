#!/usr/bin/env bash
# Builds l1/fuji/icm-relayer.json for the dockerised ava-labs icm-relayer (compose profile "icm").
#
# Source: the config avalanche-cli generated when l1/fuji/up.sh ran `avalanche interchain relayer
# deploy --fuji` (it already holds the source/destination chains, registry addresses and the
# funded relayer keys). This script copies it and only adapts it to run inside Docker:
#   - 127.0.0.1 / localhost endpoints → the host IP (same rule as docker-env.sh)
#   - storage-location → /icm-relayer-db (the "icmdb" volume)
#   - drops the per-chain "vm" field: icm-relayer ≥ v1.7.5 rejects configs that still have it, and
#     Fuji after the Helicon upgrade needs ≥ v1.8 (docker-compose.yml, ICM_RELAYER_VERSION)
#
#   ICM_RELAYER_SOURCE=/path/to/icm-relayer-config.json   use a specific source file
#   HOST_IP=…                                             see docker-env.sh
# The output contains private keys: it is gitignored and written with mode 600.
set -euo pipefail
cd "$(dirname "$0")"
[ -f ../../.env ] && { set -a; . ../../.env; set +a; }
OUT=icm-relayer.json

if [ -z "${HOST_IP:-}" ]; then
  if [ "$(uname)" = "Darwin" ]; then HOST_IP=192.168.65.254
  else HOST_IP=$(ip -4 -o addr show docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 || true); HOST_IP=${HOST_IP:-172.17.0.1}; fi
fi

SRC=${ICM_RELAYER_SOURCE:-}
if [ -z "$SRC" ]; then
  # newest relayer config avalanche-cli wrote that is not for a local network
  SRC=$(find "$HOME/.avalanche-cli" -name 'icm-relayer-config.json' -not -path '*network_*' -print0 2>/dev/null \
        | xargs -0 ls -t 2>/dev/null | head -1 || true)
fi
if [ -z "$SRC" ] || [ ! -f "$SRC" ]; then
  cat <<EOT
No icm-relayer config from avalanche-cli was found under ~/.avalanche-cli.
Either run the relayer step of l1/fuji/up.sh first:
  avalanche interchain relayer deploy --fuji --blockchains \${L1_NAME:-vatantafuji} --cchain --key <key> ...
or point to a config file:  ICM_RELAYER_SOURCE=/path/to/icm-relayer-config.json $0
EOT
  exit 1
fi

# The validator node on this machine: its NodeID becomes a manually tracked peer, so the relayer
# can collect the L1 validator's signature over P2P (the node is usually behind NAT, so the IP it
# gossips is not reachable from the container).
NODE_INFO=${FUJI_NODE_INFO:-http://127.0.0.1:9650}
NODE_ID=$(curl -fsS -m 5 -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}' "$NODE_INFO/ext/info" 2>/dev/null \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["nodeID"])' 2>/dev/null || true)
[ -n "$NODE_ID" ] || echo "WARNING: no node at $NODE_INFO, so no manually tracked peer (L1 → C-Chain messages need it)"

umask 077
# The public Fuji API caps eth_getLogs at 100 blocks while icm-relayer back-fills in 200-block
# ranges (after a WebSocket drop), exits, and restarts in a loop. Its C-Chain RPC therefore uses an
# the c-rpc service (l1/fuji/rpc-failover.py: several endpoints, getLogs chunked); the WebSocket stays public.
ICM_C_RPC=${ICM_C_RPC:-http://c-rpc:8545/ext/bc/C/rpc}  # avalanchego-style path: icm-relayer derives …/proposervm from it
DEP=${DEPLOYMENT_FILE:-../../contracts/deployments/${NETWORK:-fuji}.json}
python3 - "$SRC" "$OUT" "$HOST_IP" "${ENDPOINT_PROXY_PORT:-9640}" "$NODE_ID" "${STAKING_PORT:-9651}" "$ICM_C_RPC" "$DEP" <<'PY'
import json, os, re, sys
src, out, host, proxy_port, node_id, staking_port, c_rpc, dep = sys.argv[1:9]
cfg = json.load(open(src))
# l1/fuji/endpoint-proxy.py only exists on the host and has no WebSocket: endpoints that went
# through it (C-Chain, P-Chain, info) use the public Fuji API instead.
proxy = re.compile(rf"^(https?|wss?)://(127\.0\.0\.1|localhost):{proxy_port}")
loop = re.compile(r"//(127\.0\.0\.1|localhost|0\.0\.0\.0)([:/])")
def fix(x):
    if isinstance(x, dict): return {k: fix(v) for k, v in x.items()}
    if isinstance(x, list): return [fix(v) for v in x]
    if isinstance(x, str):
        m = proxy.match(x)
        if m:
            return ("wss" if m.group(1).startswith("ws") else "https") + "://api.avax-test.network" + x[m.end():]
        return loop.sub(rf"//{host}\2", x)
    return x
cfg = fix(cfg)
cfg["storage-location"] = "/icm-relayer-db"
C_CHAIN_FUJI = "yH8D7ThNJkxmtkuv2jgBa4P1Rn3Qpr4pPr7QYNfcdoS6k6HWp"
for key in ("source-blockchains", "destination-blockchains"):
    for b in cfg.get(key, []):
        if b.get("blockchain-id") == C_CHAIN_FUJI and c_rpc:
            b["rpc-endpoint"] = {"base-url": c_rpc}
if node_id:
    cfg["manually-tracked-peers"] = [{"id": node_id, "ip": f"{host}:{staking_port}"}]
# fields avalanche-cli still writes but icm-relayer ≥ v1.8 rejects ("invalid keys")
cfg.pop("decider-url", None)
for key in ("source-blockchains", "destination-blockchains"):
    for b in cfg.get(key, []):
        b.pop("vm", None)
        b.pop("warp-api-endpoint", None)
# Withdraw destination L1s (SPEC §14, contracts/script/add-destination.sh): relay them → C-Chain
# (TokenRemote registration) and C-Chain → them (withdrawals). They reuse the C-Chain entry's
# relayer key, which needs the L1's gas token, and the standard Teleporter messenger.
C_ENTRY = next((b for b in cfg.get("destination-blockchains", []) if b.get("blockchain-id") == C_CHAIN_FUJI), None)
C_SOURCE = next((b for b in cfg.get("source-blockchains", []) if b.get("blockchain-id") == C_CHAIN_FUJI), None)
dests = json.load(open(dep)).get("destinations", []) if os.path.exists(dep) else []
for d in dests:
    bid = d["blockchainIdCb58"]
    if C_ENTRY is None or C_SOURCE is None:
        sys.exit("no C-Chain entry in the source config to copy the destination L1 settings from")
    ws = re.sub(r"^http", "ws", d["rpc"]); ws = re.sub(r"/rpc$", "/ws", ws)
    msg = {k: v for k, v in C_SOURCE["message-contracts"].items() if v.get("message-format") == "teleporter"}
    if d.get("icmRegistry"):
        msg["0x0000000000000000000000000000000000000000"] = {"message-format": "off-chain-registry", "settings": {"teleporter-registry-address": d["icmRegistry"]}}
    cfg["source-blockchains"] = [b for b in cfg["source-blockchains"] if b.get("blockchain-id") != bid] + [{
        "subnet-id": d["subnetId"], "blockchain-id": bid,
        "rpc-endpoint": {"base-url": d["rpc"]}, "ws-endpoint": {"base-url": ws},
        "message-contracts": msg, "process-historical-blocks-from-height": 0}]
    dst = {k: v for k, v in C_ENTRY.items() if k not in ("subnet-id", "blockchain-id", "rpc-endpoint")}
    dst.update({"subnet-id": d["subnetId"], "blockchain-id": bid, "rpc-endpoint": {"base-url": d["rpc"]}})
    cfg["destination-blockchains"] = [b for b in cfg["destination-blockchains"] if b.get("blockchain-id") != bid] + [dst]
    print(f"  + destination L1 {d['name']} ({bid})")
srcs = cfg.get("source-blockchains", [])
dsts = cfg.get("destination-blockchains", [])
if not srcs or not dsts:
    sys.exit(f"{src}: no source/destination blockchains — is this an icm-relayer config?")
json.dump(cfg, open(out, "w"), indent=2)
print(f"wrote l1/fuji/{out} from {src}")
print(f"  {len(srcs)} source and {len(dsts)} destination chains; endpoints:")
for b in srcs:
    print("   ", b.get("blockchain-id"), b.get("rpc-endpoint", {}).get("base-url"))
PY

if pgrep -f 'icm-relayer.*runs/Fuji' >/dev/null 2>&1; then
  echo
  echo "WARNING: an icm-relayer started by avalanche-cli is still running on this machine."
  echo "Two relayers with the same keys fight over nonces. Stop it before starting the Docker one:"
  echo "  avalanche interchain relayer stop --fuji"
fi
