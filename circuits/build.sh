#!/usr/bin/env bash
# Compile circuits, write EVM verification keys and Solidity verifiers.
# Outputs:
#   circuits/target/<c>.json            ACIR + ABI (used by the SDK prover)
#   circuits/target/<c>/vk, vk_hash     EVM (keccak) verification keys
#   contracts/src/verifiers/<C>Verifier.sol   generated, identifiers prefixed per circuit
#   sdk/circuits/<c>.json, <c>.vk       copies for the SDK
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/toolchain/nargo:$HOME/.local/toolchain/bb:$PATH"
nargo compile --workspace --silence-warnings
OUT=../contracts/src/verifiers
mkdir -p "$OUT" ../sdk/circuits
for c in transfer split withdraw; do
  P="$(tr '[:lower:]' '[:upper:]' <<< ${c:0:1})${c:1}"
  mkdir -p target/$c
  bb write_vk -b target/$c.json -o target/$c -t evm >/dev/null
  bb write_solidity_verifier -k target/$c/vk -o target/$c/Verifier.sol -t evm >/dev/null
  # Prefix every top-level identifier so the three verifiers can live in one compilation unit.
  names=$(grep -oE '^(abstract contract|contract|library|interface) [A-Za-z0-9_]+' target/$c/Verifier.sol | awk '{print $NF}' | sort -u)
  cp target/$c/Verifier.sol "$OUT/${P}Verifier.sol"
  for n in $names; do perl -pi -e "s/\\b$n\\b/${P}_$n/g" "$OUT/${P}Verifier.sol"; done
  perl -pi -e "s/\\b${P}_HonkVerifier\\b/${P}Verifier/g" "$OUT/${P}Verifier.sol"
  cp target/$c.json ../sdk/circuits/$c.json
  cp target/$c/vk ../sdk/circuits/$c.vk
  VKH="0x$(xxd -p -c 64 target/$c/vk_hash)"
  GATES=$(bb gates -b target/$c.json 2>/dev/null | python3 -c "import json,sys;d=json.load(sys.stdin)['functions'][0];print(d['circuit_size'],d['acir_opcodes'])")
  NPI=$(python3 -c "import json;a=json.load(open('target/$c.json'))['abi']['parameters'];import math
def sz(t):
  k=t['kind']
  return t['length']*sz(t['type']) if k=='array' else sum(sz(f['type']) for f in t['fields']) if k=='struct' else 1
print(sum(sz(p['type']) for p in a if p['visibility']=='public'))")
  printf '{"name":"%s","gates":%s,"acirOpcodes":%s,"publicInputs":%s,"vkHash":"%s"}\n' $c ${GATES% *} ${GATES#* } $NPI $VKH > ../sdk/circuits/$c.meta.json
  echo "$c: vk_hash $VKH gates ${GATES% *} public_inputs $NPI"
done
