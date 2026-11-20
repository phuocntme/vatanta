import { parseAbi } from "viem";

export const shieldedPoolAbi = parseAbi([
  "struct NoteData { bytes ciphertext; uint8 viewTag; }",
  "struct TransferArgs { uint256 root; uint256[2] nullifiers; uint256[2] commitments; uint256 fee; address relayer; NoteData[2] notes; }",
  "struct SplitArgs { uint256 root; uint256[2] nullifiers; uint256[12] denomCommitments; uint256 changeCommitment; uint256 fee; address relayer; NoteData[13] notes; }",
  "struct WithdrawArgs { uint256 root; uint256 nullifier; uint256 amount; address recipient; address relayer; bytes32 destBlockchainId; address destTransferrer; }",
  "function transfer(bytes proof, TransferArgs a)",
  "function split(bytes proof, SplitArgs a)",
  "function withdraw(bytes proof, WithdrawArgs a)",
  "function isKnownRoot(uint256 root) view returns (bool)",
  "function currentRoot() view returns (uint256)",
  "function nextIndex() view returns (uint32)",
  "function nullifierSpent(uint256) view returns (bool)",
  "function depositCount(uint256) view returns (uint256)",
  "function withdrawCount(uint256) view returns (uint256)",
  "function totalTransfers() view returns (uint256)",
  "function token() view returns (address)",
  "function netOf(uint256) pure returns (uint256)",
  "function extDataHash(NoteData[] notes) pure returns (uint256)",
  "function withdrawExtDataHash(bytes32 destBlockchainId, address destTransferrer) pure returns (uint256)",
  "event Deposit(uint32 indexed leafIndex, uint256 commitment, uint256 amount, uint256 denomination, uint256 precommit)",
  "event NoteCommitted(uint32 indexed leafIndex, uint256 commitment, uint8 viewTag, bytes ciphertext)",
  "event NullifierSpent(uint256 indexed nullifier)",
  "event Transfer(uint256 nullifier0, uint256 nullifier1, address indexed relayer, uint256 fee)",
  "event Split(uint256 nullifier0, uint256 nullifier1, uint256 pieces, address indexed relayer, uint256 fee)",
  "event Withdrawal(uint256 indexed nullifier, uint256 denomination, address recipient, address indexed relayer, uint256 fee, bytes32 destination, address destTransferrer)",
  "event RootUpdated(uint256 indexed root, uint32 nextIndex)",
  "error UnknownRoot()",
  "error NullifierAlreadySpent(uint256 nullifier)",
  "error DuplicateNullifier()",
  "error WrongFee()",
  "error InvalidProof()",
  "error NotADenomination(uint256 amount)",
  "error CiphertextTooLong()",
  "error ZeroRecipient()",
  "error TokenTransferFailed()",
]);

export const depositRouterAbi = parseAbi([
  "struct Piece { uint256 denomination; bytes32 precommit; }",
  "struct DepositIntent { address owner; uint256 gross; Piece[] pieces; address feeRecipient; uint256 nonce; uint256 deadline; }",
  "struct Sig { uint8 v; bytes32 r; bytes32 s; }",
  "function deposit(DepositIntent it, Sig permitSig, Sig intentSig)",
  "function intentDigest(DepositIntent it) view returns (bytes32)",
  "function piecesHash(Piece[] pieces) pure returns (bytes32)",
  "function nonceUsed(address, uint256) view returns (bool)",
  "function totalDeposits() view returns (uint256)",
  "function piecesByDenomination(uint256) view returns (uint256)",
  "function pool() view returns (address)",
  "event Deposited(address indexed owner, uint256 gross, uint256 fee, uint256 pieces, address feeRecipient)",
  "event PieceBridged(address indexed owner, uint256 denomination, uint256 net, bytes32 precommit)",
  "error Expired()",
  "error NonceUsed()",
  "error BadIntentSignature()",
  "error BadAmount()",
  "error NotADenomination(uint256 d)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function nonces(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function transfer(address, uint256) returns (bool)",
  "function mint(address, uint256)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const relayerRegistryAbi = parseAbi([
  "function register(string url, uint256 sendFee, uint16 feeBps)",
  "function active() view returns (address[] addrs, string[] urls)",
]);

/** C-Chain list of L1 withdraw destinations (contracts/src/DestinationRegistry.sol, SPEC §14). */
export const destinationRegistryAbi = parseAbi([
  "struct Destination { bytes32 blockchainId; address tokenRemote; uint256 evmChainId; string name; address registrant; }",
  "function all() view returns (Destination[])",
  "function count() view returns (uint256)",
  "function add(bytes32 blockchainId, address tokenRemote, uint256 evmChainId, string name) returns (uint256)",
  "event DestinationAdded(uint256 indexed index, bytes32 indexed blockchainId, address tokenRemote, uint256 evmChainId, string name)",
]);
