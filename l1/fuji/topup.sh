#!/usr/bin/env bash
# Top up the Fuji L1 validator's P-Chain balance (continuous fee ≈ 0.044 AVAX/day per validator).
# When the balance runs out the validator turns inactive and the L1 stops producing blocks; state is
# kept, and a top-up makes it active again.   Usage: l1/fuji/topup.sh 0.1
#
# Uses l1/fuji/ptool (official avalanchego wallet): `avalanche validator increaseBalance` needs
# platform.getBalance, which the public Fuji API no longer serves.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env ] && { set -a; . ./.env; set +a; }
AMOUNT=${1:?AVAX amount, e.g. 0.1}
NAME=${L1_NAME:-vatantafuji}
KEYFILE="$HOME/.avalanche-cli/key/${CLI_KEY:-vatanta-fuji}.pk"
SIDECAR="$HOME/.avalanche-cli/subnets/$NAME/sidecar.json"
NAVAX=$(python3 -c "print(round(float('$AMOUNT') * 1e9))")
for VID in $(python3 -c "import json;[print(v['ValidationID']) for v in json.load(open('$SIDECAR'))['Networks']['Fuji']['BootstrapValidators']]"); do
  (cd l1/fuji/ptool && go run . "$KEYFILE" increase "$VID" "$NAVAX")
  curl -fsS -X POST -H 'content-type: application/json' \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"platform.getL1Validator\",\"params\":{\"validationID\":\"$VID\"}}" \
    https://api.avax-test.network/ext/bc/P \
    | python3 -c "import json,sys;print('  validator $VID balance:', int(json.load(sys.stdin)['result']['balance'])/1e9, 'AVAX')"
done
