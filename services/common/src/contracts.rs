//! ABI bindings (must match contracts/src). Struct layouts mirror ShieldedPool/DepositRouter.
#![allow(clippy::too_many_arguments)]
use alloy::sol;

sol! {
    #[sol(rpc)]
    #[derive(Debug)]
    contract ShieldedPool {
        struct NoteData { bytes ciphertext; uint8 viewTag; }
        struct TransferArgs { uint256 root; uint256[2] nullifiers; uint256[2] commitments; uint256 fee; address relayer; NoteData[2] notes; }
        struct SplitArgs { uint256 root; uint256[2] nullifiers; uint256[12] denomCommitments; uint256 changeCommitment; uint256 fee; address relayer; NoteData[13] notes; }
        struct WithdrawArgs { uint256 root; uint256 nullifier; uint256 amount; address recipient; address relayer; bytes32 destBlockchainId; address destTransferrer; }

        function transfer(bytes proof, TransferArgs a) external;
        function split(bytes proof, SplitArgs a) external;
        function withdraw(bytes proof, WithdrawArgs a) external;
        function isKnownRoot(uint256 root) external view returns (bool);
        function currentRoot() external view returns (uint256);
        function nextIndex() external view returns (uint32);
        function nullifierSpent(uint256) external view returns (bool);
        function depositCount(uint256) external view returns (uint256);
        function withdrawCount(uint256) external view returns (uint256);
        function totalTransfers() external view returns (uint256);

        event Deposit(uint32 indexed leafIndex, uint256 commitment, uint256 amount, uint256 denomination, uint256 precommit);
        event NoteCommitted(uint32 indexed leafIndex, uint256 commitment, uint8 viewTag, bytes ciphertext);
        event NullifierSpent(uint256 indexed nullifier);
        event Transfer(uint256 nullifier0, uint256 nullifier1, address indexed relayer, uint256 fee);
        event Split(uint256 nullifier0, uint256 nullifier1, uint256 pieces, address indexed relayer, uint256 fee);
        event Withdrawal(uint256 indexed nullifier, uint256 denomination, address recipient, address indexed relayer, uint256 fee, bytes32 destination, address destTransferrer);
        event RootUpdated(uint256 indexed root, uint32 nextIndex);

        error UnknownRoot();
        error NullifierAlreadySpent(uint256 nullifier);
        error DuplicateNullifier();
        error WrongFee();
        error InvalidProof();
        error NotADenomination(uint256 amount);
        error CiphertextTooLong();
        error ZeroRecipient();
        error TokenTransferFailed();
        error BadDestination();
    }

    #[sol(rpc)]
    #[derive(Debug)]
    contract DepositRouter {
        struct Piece { uint256 denomination; bytes32 precommit; }
        struct DepositIntent { address owner; uint256 gross; Piece[] pieces; address feeRecipient; uint256 nonce; uint256 deadline; }
        struct Sig { uint8 v; bytes32 r; bytes32 s; }

        function deposit(DepositIntent it, Sig permitSig, Sig intentSig) external;
        function intentDigest(DepositIntent it) external view returns (bytes32);
        function nonceUsed(address, uint256) external view returns (bool);
        function totalDeposits() external view returns (uint256);
        function piecesByDenomination(uint256) external view returns (uint256);

        event Deposited(address indexed owner, uint256 gross, uint256 fee, uint256 pieces, address feeRecipient);
        event PieceBridged(address indexed owner, uint256 denomination, uint256 net, bytes32 precommit);

        error Expired();
        error NonceUsed();
        error BadIntentSignature();
        error BadAmount();
        error NotADenomination(uint256 d);
    }

    /// C-Chain list of L1 withdraw destinations (contracts/src/DestinationRegistry.sol, SPEC §14).
    #[sol(rpc)]
    #[derive(Debug)]
    contract DestinationRegistry {
        struct Destination { bytes32 blockchainId; address tokenRemote; uint256 evmChainId; string name; address registrant; }
        function all() external view returns (Destination[] memory);
    }

    /// Local/test networks only (contracts/src/mocks/MockUSDC.sol).
    #[sol(rpc)]
    contract MockUSDC {
        function mint(address to, uint256 amount) external;
    }

    #[sol(rpc)]
    contract ERC20 {
        function balanceOf(address) external view returns (uint256);
        function transfer(address, uint256) external returns (bool);
    }
}

/// Decode a revert payload into a short error name for API responses.
pub fn revert_name(data: &[u8]) -> Option<String> {
    use alloy::sol_types::SolInterface;
    if let Ok(e) = ShieldedPool::ShieldedPoolErrors::abi_decode(data) {
        return Some(format!("{e:?}").split(['(', ' ', '{']).next().unwrap_or("").to_string());
    }
    if let Ok(e) = DepositRouter::DepositRouterErrors::abi_decode(data) {
        return Some(format!("{e:?}").split(['(', ' ', '{']).next().unwrap_or("").to_string());
    }
    None
}
