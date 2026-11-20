#!/usr/bin/env bash
# Deploys Vatanta across C-Chain and the L1.  Usage: contracts/script/deploy.sh <env-file>
#   local: l1/.local.env (written by l1/local-up.sh)     Fuji: .env (see .env.example)
# Writes contracts/deployments/$NETWORK.json
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=${1:?env file}
set -a; source "$ENV_FILE"; set +a
: "${NETWORK:?}" "${C_RPC:?}" "${L1_RPC:?}" "${DEPLOYER_PK:?}" "${C_ICM_REGISTRY:?}" "${L1_ICM_REGISTRY:?}"
WARP=0x0200000000000000000000000000000000000005
[ -n "${C_BLOCKCHAIN_ID:-}" ] || export C_BLOCKCHAIN_ID=$(cast call $WARP "getBlockchainID()(bytes32)" --rpc-url "$C_RPC")
[ -n "${L1_BLOCKCHAIN_ID:-}" ] || export L1_BLOCKCHAIN_ID=$(cast call $WARP "getBlockchainID()(bytes32)" --rpc-url "$L1_RPC")
[ -n "${USDC:-}" ] || unset USDC
for pair in "C_ICM_REGISTRY:$C_RPC" "L1_ICM_REGISTRY:$L1_RPC"; do
  var=${pair%%:*}; rpc=${pair#*:}
  [ "$(cast code "${!var}" --rpc-url "$rpc")" != "0x" ] || { echo "$var=${!var} has no code on $rpc"; exit 1; }
done
mkdir -p deployments
OUT=deployments/$NETWORK.json
meta() { python3 -c "import json;print(json.load(open('../sdk/circuits/$1.meta.json'))['vkHash'])"; }
export VK_TRANSFER=$(meta transfer) VK_SPLIT=$(meta split) VK_WITHDRAW=$(meta withdraw)
KV=$(mktemp)
get() { awk -v k="$1" '$1==k{print $2}' "$KV" | tail -1; }
run() { # phase rpc
  local log
  log=$(forge script script/Deploy.s.sol:Deploy --sig "$1()" --rpc-url "$2" --sender "$(cast wallet address "$DEPLOYER_PK")" --broadcast --slow --skip-simulation 2>&1) || { echo "$log" | tail -30; exit 1; }
  while read -r _ k a; do echo "$k $a" >> "$KV"; echo "  $k = $a"; done < <(echo "$log" | grep -oE "DEPLOYED [A-Za-z]+ 0x[0-9a-fA-F]{40}")
}
echo "[1/6] C-Chain: USDC + TokenHome"; run phaseHome "$C_RPC"
export USDC_ADDR=$(get usdc) TOKEN_HOME=$(get tokenHome)
echo "[2/6] L1: TokenRemote + verifiers + registries"; run phaseRemote "$L1_RPC"
export TOKEN_REMOTE=$(get tokenRemote) VERIFIER_REGISTRY=$(get verifierRegistry)
echo "[3/6] C-Chain: DepositRouter"; run phaseRouter "$C_RPC"
export DEPOSIT_ROUTER=$(get depositRouter)
echo "[4/6] L1: ShieldedPool"; run phasePool "$L1_RPC"
export SHIELDED_POOL=$(get shieldedPool)
echo "[5/6] C-Chain: router.setPool"; run phaseWire "$C_RPC"
echo "[6/6] C-Chain: DestinationRegistry"; run phaseDestinations "$C_RPC"

echo "waiting for TokenRemote registration to reach TokenHome over ICM..."
for i in $(seq 1 90); do
  r=$(cast call "$TOKEN_HOME" "getRemoteTokenTransferrerSettings(bytes32,address)((bool,uint256,uint256,bool))" "$L1_BLOCKCHAIN_ID" "$TOKEN_REMOTE" --rpc-url "$C_RPC" 2>/dev/null || true)
  [[ "$r" == "(true"* ]] && { echo "  registered after ${i}s"; break; }
  sleep 1
  [ "$i" = 90 ] && { echo "  TokenRemote not registered (is the ICM relayer running?)"; exit 1; }
done
START_L1=$(cast block-number --rpc-url "$L1_RPC")
START_C=$(cast block-number --rpc-url "$C_RPC")
python3 - "$OUT" <<PY
import json,sys
d={"network":"$NETWORK","cChainId":int("$(cast chain-id --rpc-url $C_RPC)"),"l1ChainId":int("$(cast chain-id --rpc-url $L1_RPC)"),
   "cRpc":"$C_RPC","l1Rpc":"$L1_RPC","cBlockchainId":"$C_BLOCKCHAIN_ID","l1BlockchainId":"$L1_BLOCKCHAIN_ID",
   "usdc":"$USDC_ADDR","usdcIsMock":"$(get usdcMock)"!="","tokenHome":"$TOKEN_HOME","tokenRemote":"$TOKEN_REMOTE",
   "depositRouter":"$DEPOSIT_ROUTER","shieldedPool":"$SHIELDED_POOL","verifierRegistry":"$VERIFIER_REGISTRY",
   "relayerRegistry":"$(get relayerRegistry)","destinationRegistry":"$(get destinationRegistry)","vkTransfer":"$VK_TRANSFER","vkSplit":"$VK_SPLIT","vkWithdraw":"$VK_WITHDRAW",
   "l1StartBlock":int("$START_L1"),"cStartBlock":int("$START_C")}
json.dump(d,open(sys.argv[1],"w"),indent=2)
print("wrote",sys.argv[1])
PY
