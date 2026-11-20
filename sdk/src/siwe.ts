import { BRAND } from "./constants.js";

/**
 * Key-derivation message for external browser wallets (SPEC.md §4.2), in Sign-In with Ethereum
 * (EIP-4361) form. Wallets that understand SIWE (MetaMask and others) compare `domain` with the
 * page that asks for the signature and warn loudly on a mismatch, so a look-alike site cannot
 * quietly collect the signature the private keys come from.
 *
 * Every field is fixed (nonce, issued-at) so the same wallet always produces the same signature
 * and therefore the same shielded account. The account is bound to `domain` and `chainId`.
 */
export interface KeyMessageParams {
  /** EIP-55 checksummed address of the signing wallet. */
  address: string;
  /** Host (and port) the app is served from, e.g. "app.vatanta.xyz" or "localhost:4001". */
  domain: string;
  /** C-Chain id of the network (43113 on Fuji). */
  chainId: number;
}

export const KEY_MESSAGE_NONCE = "vatantakeysv2";
export const KEY_MESSAGE_ISSUED_AT = "2026-01-01T00:00:00.000Z";

const isLocal = (domain: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(domain);

export function keyMessage({ address, domain, chainId }: KeyMessageParams): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("keyMessage: address must be a 0x-prefixed 20-byte hex string");
  if (!domain || /[\s/]/.test(domain)) throw new Error("keyMessage: domain must be a bare host[:port]");
  const uri = `${isLocal(domain) ? "http" : "https"}://${domain}`;
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    `Unlock your ${BRAND} private balance. This creates your private keys on this device and costs no gas. Only sign this on ${domain}.`,
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${KEY_MESSAGE_NONCE}`,
    `Issued At: ${KEY_MESSAGE_ISSUED_AT}`,
  ].join("\n");
}
