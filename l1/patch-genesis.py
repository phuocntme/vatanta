#!/usr/bin/env python3
"""Apply Vatanta's "gasless-feeling" fee config to a Subnet-EVM genesis (SPEC.md §11)."""
import json, sys
p = sys.argv[1]
g = json.load(open(p))
fc = g["config"]["feeConfig"]
fc.update(gasLimit=20_000_000, minBaseFee=1_000_000_000, targetGas=100_000_000, targetBlockRate=2)
g["gasLimit"] = hex(20_000_000)
# Fuji: give the deployer / relayer L1 gas tokens (VNT) at genesis. ALLOC="0xabc…,0xdef…"
import os
for addr in filter(None, os.environ.get("ALLOC", "").split(",")):
    g.setdefault("alloc", {})[addr.lower().removeprefix("0x")] = {"balance": hex(1_000_000 * 10**18)}
json.dump(g, open(p, "w"), indent=2)
print(f"patched {p}: gasLimit=20M minBaseFee=1 gwei")
