/**
 * Re-emits the Teleporter (ICM) messages a transaction sent, so a running icm-relayer delivers them.
 * Use it when a message was sent while the relayer was down (it does not replay missed blocks).
 * retrySendCrossChainMessage is permissionless: it only re-emits a message the messenger already
 * stored, unchanged.
 *
 *   RPC=<source chain rpc> PK=<any funded key> npx tsx src/icm-retry.ts <txHash>
 */
import { createPublicClient, createWalletClient, decodeEventLog, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const MESSENGER = (process.env.MESSENGER ?? "0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf") as Hex;
const abi = parseAbi([
  "struct TeleporterMessageReceipt { uint256 receivedMessageNonce; address relayerRewardAddress; }",
  "struct TeleporterMessage { uint256 messageNonce; address originSenderAddress; bytes32 destinationBlockchainID; address destinationAddress; uint256 requiredGasLimit; address[] allowedRelayerAddresses; TeleporterMessageReceipt[] receipts; bytes message; }",
  "struct TeleporterFeeInfo { address feeTokenAddress; uint256 amount; }",
  "event SendCrossChainMessage(bytes32 indexed messageID, bytes32 indexed destinationBlockchainID, TeleporterMessage message, TeleporterFeeInfo feeInfo)",
  "function retrySendCrossChainMessage(TeleporterMessage message)",
]);

async function main() {
  const tx = process.argv[2] as Hex;
  const rpc = process.env.RPC;
  const pk = process.env.PK as Hex | undefined;
  if (!tx || !rpc || !pk) throw new Error("usage: RPC=… PK=… tsx src/icm-retry.ts <txHash>");
  const pub = createPublicClient({ transport: http(rpc) });
  const chainId = await pub.getChainId();
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, transport: http(rpc), chain: { id: chainId, name: "src", nativeCurrency: { name: "N", symbol: "N", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } });
  const receipt = await pub.getTransactionReceipt({ hash: tx });
  let n = 0;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== MESSENGER.toLowerCase()) continue;
    try {
      const e = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (e.eventName !== "SendCrossChainMessage") continue;
      const h = await wallet.writeContract({ address: MESSENGER, abi, functionName: "retrySendCrossChainMessage", args: [e.args.message] });
      await pub.waitForTransactionReceipt({ hash: h });
      console.log(`re-emitted message ${e.args.messageID} → ${e.args.destinationBlockchainID}: ${h}`);
      n++;
    } catch (err) {
      if ((err as Error).name !== "AbiEventSignatureNotFoundError") throw err;
    }
  }
  if (n === 0) console.log("no SendCrossChainMessage in that transaction");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
