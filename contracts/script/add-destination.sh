#!/usr/bin/env bash
# Integrates an Avalanche L1 as a withdraw destination (SPEC §14). Anyone can do this for any L1
# that runs ICM (Teleporter): deploy an ICTT ERC20TokenRemote for Vatanta's TokenHome on the L1,
# register it with the home, then list it in the C-Chain DestinationRegistry.
#   Usage: DEST_NAME=Echo DEST_RPC=https://… contracts/script/add-destination.sh <env-file>
#   Optional: DEST_ICM_REGISTRY (the L1's TeleporterRegistry; deployed if unset), DEST_PK (key with
#   gas on the L1; defaults to DEPLOYER_PK, which also pays the C-Chain listing),
#   ICM_RESTART (command run before the TokenRemote is deployed, e.g. regenerate the icm-relayer
#   config and restart it: the relayer must relay this L1 → C-Chain for the registration and
#   C-Chain → this L1 for withdrawals; l1/fuji/icm-relayer-config.sh adds every chain listed under
#   "destinations" in the deployment file).
#   UNLISTED=1 (test remote: stored under "testDestinations", not listed for users and not added to
#   the icm-relayer config; e.g. a second TokenRemote on the Vatanta L1 itself, which already relays).
# Resumable: rerunning skips the TokenRemote deployment if the deployment file already has it.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=${1:?env file}
set -a; source "$ENV_FILE"; set +a
: "${NETWORK:?}" "${C_RPC:?}" "${DEPLOYER_PK:?}" "${DEST_NAME:?}" "${DEST_RPC:?}"
OUT=deployments/$NETWORK.json
j() { python3 -c "import json;print(json.load(open('$OUT')).get('$1') or '')"; }
export C_BLOCKCHAIN_ID=$(j cBlockchainId) TOKEN_HOME=$(j tokenHome) DESTINATION_REGISTRY=$(j destinationRegistry)
[ -n "$DESTINATION_REGISTRY" ] || { echo "no destinationRegistry in $OUT: run upgrade-pool.sh or deploy.sh"; exit 1; }
WARP=0x0200000000000000000000000000000000000005
MESSENGER=${DEST_MESSENGER:-0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf}
export DEST_BLOCKCHAIN_ID=$(cast call $WARP "getBlockchainID()(bytes32)" --rpc-url "$DEST_RPC")
export DEST_CHAIN_ID=$(cast chain-id --rpc-url "$DEST_RPC")
[ "$(cast code "$MESSENGER" --rpc-url "$DEST_RPC")" != "0x" ] || { echo "$DEST_NAME has no Teleporter messenger at $MESSENGER"; exit 1; }
PK=${DEST_PK:-$DEPLOYER_PK}
FROM=$(cast wallet address "$PK")
echo "$DEST_NAME: chain id $DEST_CHAIN_ID, blockchain id $DEST_BLOCKCHAIN_ID, deployer $FROM ($(cast balance "$FROM" --rpc-url "$DEST_RPC" -e) native)"

KV=$(mktemp)
get() { awk -v k="$1" '$1==k{print $2}' "$KV" | tail -1; }
run() { # phase rpc pk
  local log
  log=$(DEPLOYER_PK=$3 forge script script/Deploy.s.sol:Deploy --sig "$1()" --rpc-url "$2" --sender "$(cast wallet address "$3")" --broadcast --slow --skip-simulation 2>&1) || { echo "$log" | tail -30; exit 1; }
  while read -r _ k a; do echo "$k $a" >> "$KV"; echo "  $k = $a"; done < <(echo "$log" | grep -oE "DEPLOYED [A-Za-z]+ 0x[0-9a-fA-F]{40}")
}
DEST_CB58=$(python3 - "$DEST_BLOCKCHAIN_ID" <<'PY'
import hashlib, sys  # bytes32 → cb58 (P-Chain form)
b = bytes.fromhex(sys.argv[1][2:]); b += hashlib.sha256(b).digest()[-4:]
A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; n = int.from_bytes(b, "big"); cb = ""
while n: n, r = divmod(n, 58); cb = A[r] + cb
print(cb)
PY
)
P_API=${P_API:-https://api.avax-test.network}
[ "$NETWORK" = "local" ] && P_API=http://127.0.0.1:9650
SUBNET_ID=$(curl -fsS -X POST -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"platform.validatedBy\",\"params\":{\"blockchainID\":\"$DEST_CB58\"}}" \
  "$P_API/ext/bc/P" | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"]["subnetID"])')
save() { # remote icmRegistry
python3 - "$OUT" "$1" "$2" <<PY
import json,sys
d=json.load(open(sys.argv[1]))
key="testDestinations" if "${UNLISTED:-}"=="1" else "destinations"
ds=[x for x in d.get(key,[]) if x["blockchainId"].lower()!="$DEST_BLOCKCHAIN_ID".lower()]
ds.append({"name":"$DEST_NAME","rpc":"$DEST_RPC","chainId":int("$DEST_CHAIN_ID"),"blockchainId":"$DEST_BLOCKCHAIN_ID",
           "blockchainIdCb58":"$DEST_CB58","subnetId":"$SUBNET_ID","tokenRemote":sys.argv[2],"icmRegistry":sys.argv[3]})
d[key]=ds
json.dump(d,open(sys.argv[1],"w"),indent=2)
PY
}
KEY=destinations; [ "${UNLISTED:-}" = "1" ] && KEY=testDestinations
DEST_TOKEN_REMOTE=$(python3 -c "import json;print(next((x['tokenRemote'] for x in json.load(open('$OUT')).get('$KEY',[]) if x['blockchainId'].lower()=='$DEST_BLOCKCHAIN_ID'.lower()),''))")
if [ -n "$DEST_TOKEN_REMOTE" ]; then
  echo "[1/3] $DEST_NAME: TokenRemote already deployed: $DEST_TOKEN_REMOTE"
else
  # The icm-relayer must already watch this L1 when registerWithHome is sent: it does not replay
  # blocks it missed (if it did, re-emit with `pnpm icm:retry <tx>` in e2e/). So record the chain
  # and restart the relayer first, then deploy.
  save "" "${DEST_ICM_REGISTRY:-}"
  if [ -n "${ICM_RESTART:-}" ]; then
    echo "  running ICM_RESTART before deploying"; bash -c "$ICM_RESTART"; sleep "${ICM_RESTART_WAIT:-30}"
  fi
  echo "[1/3] $DEST_NAME: TokenRemote (+ registerWithHome)"; run phaseDestRemote "$DEST_RPC" "$PK"
  DEST_TOKEN_REMOTE=$(get destTokenRemote)
  save "$DEST_TOKEN_REMOTE" "$(get destIcmRegistry)${DEST_ICM_REGISTRY:-}"
fi
export DEST_TOKEN_REMOTE

echo "[2/3] waiting for the registration to reach the TokenHome over ICM (needs the icm-relayer)..."
for i in $(seq 1 300); do
  r=$(cast call "$TOKEN_HOME" "getRemoteTokenTransferrerSettings(bytes32,address)((bool,uint256,uint256,bool))" "$DEST_BLOCKCHAIN_ID" "$DEST_TOKEN_REMOTE" --rpc-url "$C_RPC" 2>/dev/null || true)
  [[ "$r" == "(true"* ]] && { echo "  registered after ${i}s"; break; }
  sleep 1
  [ "$i" = 300 ] && { echo "  not registered after 5 min: is the icm-relayer relaying $DEST_NAME → C-Chain?"; exit 1; }
done

[ "${UNLISTED:-}" = "1" ] && { echo "[3/3] UNLISTED=1: not listed in the DestinationRegistry"; exit 0; }
echo "[3/3] C-Chain: list it in the DestinationRegistry"; run phaseAddDestination "$C_RPC" "$DEPLOYER_PK"
echo "added $DEST_NAME to $OUT"
