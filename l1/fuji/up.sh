#!/usr/bin/env bash
# Create and deploy the Vatanta L1 on Fuji (requires a funded key and validator machine).
#
# Prerequisites (see l1/fuji/README.md):
#   - avalanche-cli 1.9.7, a CLI key with Fuji AVAX on C-Chain and P-Chain:
#       avalanche key create vatanta-fuji && fund it from https://core.app/tools/testnet-faucet
#   - 1 validator for a first deploy (this machine or a server), 3–5 for the demo
#   - VALIDATOR_MANAGER_OWNER: address that will own PoA validator management (default: the CLI key)
#   - VALIDATOR_BALANCE: AVAX for the validator's continuous fee (default 0.05 ≈ 1 day; top up with topup.sh)
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/toolchain/avalanche:$PATH"
[ -f ../../.env ] && { set -a; . ../../.env; set +a; }
KEY=${CLI_KEY:-vatanta-fuji}
KEY_ADDR=$(cast wallet address "0x$(cat "$HOME/.avalanche-cli/key/$KEY.pk")")
VALIDATOR_MANAGER_OWNER=${VALIDATOR_MANAGER_OWNER:-$KEY_ADDR}
# L1 gas tokens at genesis for the deployer and the relayer
export ALLOC="$KEY_ADDR${RELAYER_PK:+,$(cast wallet address "$RELAYER_PK")}"
NAME=${L1_NAME:-vatantafuji}

if [ ! -f "$HOME/.avalanche-cli/subnets/$NAME/genesis.json" ]; then
  avalanche blockchain create "$NAME" --evm --proof-of-authority \
    --validator-manager-owner "$VALIDATOR_MANAGER_OWNER" --proxy-contract-owner "$VALIDATOR_MANAGER_OWNER" \
    --evm-chain-id 777001 --evm-token VNT --production-defaults --icm --latest
  ../patch-genesis.py "$HOME/.avalanche-cli/subnets/$NAME/genesis.json"
fi

# Deploys the L1 to Fuji. By default avalanche-cli starts the bootstrap validator on this machine
# (--use-local-machine); for remote validators pass --bootstrap-endpoints / --bootstrap-filepath.
avalanche blockchain deploy "$NAME" --fuji --key "$KEY" --balance "${VALIDATOR_BALANCE:-0.05}" ${BOOTSTRAP_FLAGS:---use-local-machine --partial-sync}

# ICM relayer between Fuji C-Chain and the L1 (self-hosted; config also usable with docker compose --profile icm)
avalanche interchain relayer deploy --fuji --blockchains "$NAME" --cchain --key "$KEY" \
  --cchain-funding-key "$KEY" --cchain-amount "${ICM_CCHAIN_AMOUNT:-0.02}" --blockchain-funding-key "$KEY" --amount 100 ${RELAYER_FLAGS:-}

avalanche blockchain describe "$NAME" | tee describe.txt
echo
echo "Next: copy the L1 RPC URL and the 'ICM Registry Address' for $NAME into .env (L1_RPC, L1_ICM_REGISTRY),"
echo "then run: contracts/script/deploy.sh .env"
