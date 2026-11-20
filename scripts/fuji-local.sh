#!/usr/bin/env bash
# Vatanta on Fuji with every off-chain service in Docker on this machine.
# The chain parts (C-Chain contracts, the L1 and its validator node) are on Fuji; postgres,
# relayer, indexer, web and icm-relayer run here exactly as they will on the VPS.
#
#   scripts/fuji-local.sh up       preflight → deploy contracts if missing → build + start → health
#   scripts/fuji-local.sh status   containers, relayer info, balances
#   scripts/fuji-local.sh logs [service]
#   scripts/fuji-local.sh down     stop (data volumes are kept)
#
#   ICM=external   do not start the dockerised icm-relayer (one is already running elsewhere)
#   SKIP_BUILD=1   start without rebuilding images
# See docs/fuji-local.md.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
export PATH="$HOME/.local/toolchain/foundry:$HOME/.local/toolchain/avalanche:$PATH"
ENVF=.run/fuji-local.env
DEP=contracts/deployments/fuji.json
PROFILES=(--profile icm)
[ "${ICM:-docker}" = "external" ] && PROFILES=()
# ${a[@]+"${a[@]}"}: empty arrays are an error under `set -u` in macOS bash 3.2
# own compose project: the local-network Docker stack ("vatanta") keeps its containers and volumes
compose() { docker compose -p "${COMPOSE_PROJECT:-vatanta-fuji}" --env-file "$ENVF" ${PROFILES[@]+"${PROFILES[@]}"} "$@"; }

red() { printf '\033[31m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { red "✗ $*"; exit 1; }

load_env() {
  [ -f .env ] || die "missing .env — cp .env.example .env and fill it (docs/fuji-local.md)"
  set -a; . ./.env; set +a
}

preflight() {
  echo "preflight"
  for b in docker cast python3 openssl curl; do command -v "$b" >/dev/null || die "$b not found in PATH"; done
  docker info >/dev/null 2>&1 || die "Docker is not running"
  ok "docker, cast, python3"
  [ "${NETWORK:-}" = "fuji" ] || die "NETWORK must be 'fuji' in .env"
  for v in RELAYER_PK C_RPC L1_RPC; do [ -n "${!v:-}" ] || die "$v is empty in .env"; done

  local cid lid
  cid=$(cast chain-id --rpc-url "$C_RPC" 2>/dev/null) || die "C_RPC $C_RPC does not answer"
  [ "$cid" = "43113" ] || die "C_RPC is chain $cid, expected Fuji C-Chain 43113"
  ok "Fuji C-Chain reachable"
  lid=$(cast chain-id --rpc-url "$L1_RPC" 2>/dev/null) \
    || die "L1_RPC $L1_RPC does not answer — is the Fuji node on this machine running and synced? (avalanche node local status)"
  ok "L1 reachable (chain id $lid)"

  RELAYER_ADDR=$(cast wallet address "$RELAYER_PK")
  local avax vnt
  avax=$(cast balance "$RELAYER_ADDR" --rpc-url "$C_RPC" --ether)
  vnt=$(cast balance "$RELAYER_ADDR" --rpc-url "$L1_RPC" --ether)
  python3 -c "import sys; sys.exit(0 if float('$avax') >= 0.005 else 1)" \
    && ok "relayer $RELAYER_ADDR has $avax AVAX on C-Chain" \
    || warn "relayer $RELAYER_ADDR has only $avax AVAX on C-Chain (it pays gas for deposits; top up to ≥ 0.01)"
  python3 -c "import sys; sys.exit(0 if float('$vnt') > 0 else 1)" \
    || die "relayer $RELAYER_ADDR has no VNT on the L1, so it cannot submit proofs.
    Send some from the deployer:  cast send $RELAYER_ADDR --value 10ether --rpc-url \$L1_RPC --private-key \$DEPLOYER_PK"
  ok "relayer has $vnt VNT on the L1"

  if [ -f "$DEP" ]; then
    local pool
    pool=$(python3 -c "import json;print(json.load(open('$DEP'))['shieldedPool'])")
    [ "$(python3 -c "import json;print(json.load(open('$DEP'))['l1ChainId'])")" = "$lid" ] \
      || die "$DEP was deployed to L1 chain $(python3 -c "import json;print(json.load(open('$DEP'))['l1ChainId'])"), but L1_RPC is chain $lid"
    [ "$(cast code "$pool" --rpc-url "$L1_RPC")" != "0x" ] \
      || die "$DEP points to ShieldedPool $pool, which has no code on this L1 (new L1?). Move $DEP away and rerun to redeploy."
    ok "contracts deployed ($DEP)"
  fi
}

deploy_if_missing() {
  [ -f "$DEP" ] && return
  echo "contracts/deployments/fuji.json missing → deploying (needs DEPLOYER_PK with C-Chain AVAX and L1 VNT)"
  for v in DEPLOYER_PK C_ICM_REGISTRY L1_ICM_REGISTRY; do [ -n "${!v:-}" ] || die "$v is empty in .env (needed to deploy)"; done
  contracts/script/deploy.sh .env
}

health() {
  local name=$1 url=$2 secs=${3:-180}
  for _ in $(seq 1 "$secs"); do
    curl -fsS "$url" >/dev/null 2>&1 && { ok "$name $url"; return 0; }
    sleep 1
  done
  red "  ✗ $name did not answer at $url — scripts/fuji-local.sh logs ${name%% *}"
  return 1
}

cmd_up() {
  load_env
  preflight
  deploy_if_missing
  l1/fuji/docker-env.sh
  if [ "${ICM:-docker}" != "external" ]; then
    l1/fuji/icm-relayer-config.sh
    # the icm-relayer image runs as uid 1001, a fresh named volume is root-owned
    local vol="${COMPOSE_PROJECT:-vatanta-fuji}_icmdb" img="avaplatform/icm-relayer:${ICM_RELAYER_VERSION:-v1.8.4}"
    docker volume create "$vol" >/dev/null
    docker run --rm --user 0 --entrypoint chown -v "$vol:/icm-relayer-db" "$img" 1001 /icm-relayer-db
  fi
  set -a; . "$ENVF"; set +a
  echo "starting containers (first build takes several minutes)"
  if [ "${SKIP_BUILD:-0}" = "1" ]; then compose up -d; else compose up -d --build; fi
  echo "health"
  local bad=0
  health "relayer" "http://127.0.0.1:$RELAYER_PORT/health" || bad=1
  health "indexer" "http://127.0.0.1:$INDEXER_PORT/health" || bad=1
  health "web" "http://127.0.0.1:$WEB_PORT/" || bad=1
  if [ "${ICM:-docker}" != "external" ]; then
    sleep 3
    [ "$(compose ps --status running -q icm-relayer)" != "" ] \
      && ok "icm-relayer running" || { red "  ✗ icm-relayer is not running — scripts/fuji-local.sh logs icm-relayer"; bad=1; }
  fi
  [ $bad = 0 ] || exit 1
  echo
  echo "Vatanta (Fuji) → http://localhost:$WEB_PORT   relayer :$RELAYER_PORT · indexer :$INDEXER_PORT"
  echo "Get Fuji test USDC at https://faucet.circle.com (Avalanche Fuji) and send it to the deposit address the app shows."
}

cmd_status() {
  load_env
  [ -f "$ENVF" ] || die "not started yet — scripts/fuji-local.sh up"
  set -a; . "$ENVF"; set +a
  compose ps
  echo
  curl -fsS "http://127.0.0.1:$RELAYER_PORT/v1/info" | python3 -m json.tool || warn "relayer not answering"
  curl -fsS "http://127.0.0.1:$INDEXER_PORT/v1/stats" | python3 -m json.tool || warn "indexer not answering"
  local r; r=$(cast wallet address "$RELAYER_PK")
  echo "relayer $r: $(cast balance "$r" --rpc-url "$C_RPC" --ether) AVAX (C-Chain), $(cast balance "$r" --rpc-url "$L1_RPC" --ether) VNT (L1)"
}

case "${1:-up}" in
  up) cmd_up ;;
  status) cmd_status ;;
  logs) [ -f "$ENVF" ] || die "not started yet"; shift; compose logs -f --tail 200 "$@" ;;
  down) [ -f "$ENVF" ] || die "not started yet"; compose down ;;
  *) echo "usage: $0 up|status|logs [service]|down"; exit 1 ;;
esac
