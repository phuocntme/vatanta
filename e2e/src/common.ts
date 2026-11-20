import type { Address, PublicClient } from "viem";
import { erc20Abi, type TokenDomain } from "@vatanta/sdk";

export async function tokenDomain(c: PublicClient, token: Address, chainId: number): Promise<TokenDomain> {
  try {
    const d = await c.readContract({ address: token, abi: erc20Abi, functionName: "eip712Domain" });
    return { name: d[1], version: d[2], chainId, verifyingContract: token };
  } catch {
    const name = await c.readContract({ address: token, abi: erc20Abi, functionName: "name" });
    const version = await c.readContract({ address: token, abi: erc20Abi, functionName: "version" });
    return { name, version, chainId, verifyingContract: token };
  }
}
