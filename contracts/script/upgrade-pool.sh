#!/usr/bin/env bash
# Replaces DepositRouter + ShieldedPool on an existing deployment and adds the DestinationRegistry
# (SPEC §14), keeping the ICTT TokenHome / TokenRemote, verifiers and relayer registry.
#   Usage: contracts/script/upgrade-pool.sh <env-file>      (Fuji: .env)
# The pool is not upgradeable: notes in the old pool stay there (test funds). The old deployment
# file is kept as deployments/<network>.<timestamp>.json. Restart relayer + indexer with a reset
# afterwards (new pool, new start blocks).
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=${1:?env file}
set -a; source "$ENV_FILE"; set +a
: "${NETWORK:?}" "${C_RPC:?}" "${L1_RPC:?}" "${DEPLOYER_PK:?}"
OUT=deployments/$NETWORK.json
[ -f "$OUT" ] || { echo "$OUT not found: run deploy.sh first"; exit 1; }
j() { python3 -c "import json,sys;print(json.load(open('$OUT'))['$1'])"; }
meta() { python3 -c "import json;print(json.load(open('../sdk/circuits/$1.meta.json'))['vkHash'])"; }
export VK_TRANSFER=$(meta transfer) VK_SPLIT=$(meta split) VK_WITHDRAW=$(meta withdraw)
for k in Transfer Split Withdraw; do
  v=VK_$(echo $k | tr a-z A-Z); [ "$(j vk$k)" = "${!v}" ] || { echo "vk$k changed since the deployment: circuits differ, run a full deploy.sh"; exit 1; }
done
export C_BLOCKCHAIN_ID=$(j cBlockchainId) L1_BLOCKCHAIN_ID=$(j l1BlockchainId) USDC_ADDR=$(j usdc) TOKEN_HOME=$(j tokenHome) \
  TOKEN_REMOTE=$(j tokenRemote) VERIFIER_REGISTRY=$(j verifierRegistry)
KV=$(mktemp)
get() { awk -v k="$1" '$1==k{print $2}' "$KV" | tail -1; }
run() { # phase rpc
  local log
  log=$(forge script script/Deploy.s.sol:Deploy --sig "$1()" --rpc-url "$2" --sender "$(cast wallet address "$DEPLOYER_PK")" --broadcast --slow --skip-simulation 2>&1) || { echo "$log" | tail -30; exit 1; }
  while read -r _ k a; do echo "$k $a" >> "$KV"; echo "  $k = $a"; done < <(echo "$log" | grep -oE "DEPLOYED [A-Za-z]+ 0x[0-9a-fA-F]{40}")
}
echo "[1/4] C-Chain: DepositRouter"; run phaseRouter "$C_RPC"
export DEPOSIT_ROUTER=$(get depositRouter)
echo "[2/4] L1: ShieldedPool"; run phasePool "$L1_RPC"
export SHIELDED_POOL=$(get shieldedPool)
echo "[3/4] C-Chain: router.setPool"; run phaseWire "$C_RPC"
echo "[4/4] C-Chain: DestinationRegistry"; run phaseDestinations "$C_RPC"
START_L1=$(cast block-number --rpc-url "$L1_RPC")
START_C=$(cast block-number --rpc-url "$C_RPC")
cp "$OUT" "deployments/$NETWORK.$(date +%Y%m%d-%H%M%S).json"
python3 - "$OUT" <<PY
import json,sys
d=json.load(open(sys.argv[1]))
d.update({"depositRouter":"$DEPOSIT_ROUTER","shieldedPool":"$SHIELDED_POOL","destinationRegistry":"$(get destinationRegistry)",
          "l1StartBlock":int("$START_L1"),"cStartBlock":int("$START_C")})
json.dump(d,open(sys.argv[1],"w"),indent=2)
print("updated",sys.argv[1])
PY
