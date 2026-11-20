// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20PermitLike} from "./interfaces/IERC20Like.sol";
import {IERC20TokenTransferrer, SendAndCallInput} from "./interfaces/IICTT.sol";

/// C-Chain entry point (SPEC.md §5). Pulls USDC from a one-time deposit address with an EIP-2612
/// permit, checks the address's EIP-712 `DepositIntent` (which binds the precommitments so the
/// relayer cannot redirect the deposit), takes 0.25 % per piece and bridges each denomination
/// piece to the ShieldedPool with ICTT `sendAndCall`. Called by a relayer; the deposit address
/// never needs AVAX.
contract DepositRouter {
    uint256 public constant USDC = 1e6;
    uint256 public constant FEE_BPS = 25;
    uint256 public constant MIN_DEPOSIT = 20 * USDC;
    uint256 public constant MAX_PIECES = 64;
    uint256 public constant REQUIRED_GAS = 2_000_000;
    uint256 public constant RECIPIENT_GAS = 1_600_000;

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "DepositIntent(address owner,uint256 gross,bytes32 piecesHash,address feeRecipient,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    IERC20PermitLike public immutable usdc;
    IERC20TokenTransferrer public immutable tokenHome;
    bytes32 public immutable l1BlockchainId;
    address public immutable tokenRemote;
    address public pool; // set once (pool is deployed on the L1 after this router)
    address public immutable deployer;

    mapping(address => mapping(uint256 => bool)) public nonceUsed;
    uint256 public totalDeposits;
    mapping(uint256 => uint256) public piecesByDenomination;

    struct Piece {
        uint256 denomination; // gross: 10 / 100 / 1,000 / 10,000 USDC
        bytes32 precommit;
    }

    struct DepositIntent {
        address owner; // the one-time deposit address
        uint256 gross;
        Piece[] pieces;
        address feeRecipient;
        uint256 nonce;
        uint256 deadline;
    }

    struct Sig {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    event Deposited(address indexed owner, uint256 gross, uint256 fee, uint256 pieces, address feeRecipient);
    event PieceBridged(address indexed owner, uint256 denomination, uint256 net, bytes32 precommit);

    error PoolAlreadySet();
    error PoolNotSet();
    error NotDeployer();
    error Expired();
    error NonceUsed();
    error BadIntentSignature();
    error BadAmount();
    error NotADenomination(uint256 d);
    error TooManyPieces();
    error TransferFailed();

    constructor(IERC20PermitLike usdc_, IERC20TokenTransferrer tokenHome_, bytes32 l1BlockchainId_, address tokenRemote_) {
        usdc = usdc_;
        tokenHome = tokenHome_;
        l1BlockchainId = l1BlockchainId_;
        tokenRemote = tokenRemote_;
        deployer = msg.sender;
    }

    function setPool(address pool_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (pool != address(0)) revert PoolAlreadySet();
        pool = pool_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("Vatanta DepositRouter"), keccak256("1"), block.chainid, address(this))
        );
    }

    function piecesHash(Piece[] calldata pieces) public pure returns (bytes32) {
        return keccak256(abi.encode(pieces));
    }

    function intentDigest(DepositIntent calldata it) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(INTENT_TYPEHASH, it.owner, it.gross, piecesHash(it.pieces), it.feeRecipient, it.nonce, it.deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function netOf(uint256 d) public pure returns (uint256) {
        return d - (d * FEE_BPS) / 10_000;
    }

    function isDenomination(uint256 a) public pure returns (bool) {
        return a == 10 * USDC || a == 100 * USDC || a == 1_000 * USDC || a == 10_000 * USDC;
    }

    /// @param permitSig EIP-2612 permit from `it.owner` to this router for `it.gross`, `it.deadline`.
    ///        Skipped if the allowance is already in place (e.g. user deposits from their own wallet).
    function deposit(DepositIntent calldata it, Sig calldata permitSig, Sig calldata intentSig) external {
        if (pool == address(0)) revert PoolNotSet();
        if (block.timestamp > it.deadline) revert Expired();
        if (nonceUsed[it.owner][it.nonce]) revert NonceUsed();
        if (it.gross < MIN_DEPOSIT || it.gross % (10 * USDC) != 0) revert BadAmount();
        uint256 n = it.pieces.length;
        if (n == 0 || n > MAX_PIECES) revert TooManyPieces();
        uint256 sum;
        for (uint256 i = 0; i < n; i++) {
            if (!isDenomination(it.pieces[i].denomination)) revert NotADenomination(it.pieces[i].denomination);
            sum += it.pieces[i].denomination;
        }
        if (sum != it.gross) revert BadAmount();

        address signer = ecrecover(intentDigest(it), intentSig.v, intentSig.r, intentSig.s);
        if (signer == address(0) || signer != it.owner) revert BadIntentSignature();
        nonceUsed[it.owner][it.nonce] = true;

        if (permitSig.r != bytes32(0)) {
            // A front-run permit leaves the allowance in place; the transferFrom below still works.
            try usdc.permit(it.owner, address(this), it.gross, it.deadline, permitSig.v, permitSig.r, permitSig.s) {}
                catch {}
        }
        if (!usdc.transferFrom(it.owner, address(this), it.gross)) revert TransferFailed();

        uint256 totalNet;
        for (uint256 i = 0; i < n; i++) {
            totalNet += netOf(it.pieces[i].denomination);
        }
        uint256 fee = it.gross - totalNet;
        if (fee > 0 && !usdc.transfer(it.feeRecipient, fee)) revert TransferFailed();
        if (!usdc.approve(address(tokenHome), totalNet)) revert TransferFailed();

        for (uint256 i = 0; i < n; i++) {
            Piece calldata p = it.pieces[i];
            uint256 net = netOf(p.denomination);
            tokenHome.sendAndCall(
                SendAndCallInput({
                    destinationBlockchainID: l1BlockchainId,
                    destinationTokenTransferrerAddress: tokenRemote,
                    recipientContract: pool,
                    recipientPayload: abi.encode(p.precommit),
                    requiredGasLimit: REQUIRED_GAS,
                    recipientGasLimit: RECIPIENT_GAS,
                    multiHopFallback: address(0),
                    // if the pool rejects the piece, the bridged USDC goes to the same one-time
                    // address on the L1, which the user controls
                    fallbackRecipient: it.owner,
                    primaryFeeTokenAddress: address(usdc),
                    primaryFee: 0,
                    secondaryFee: 0
                }),
                net
            );
            piecesByDenomination[p.denomination]++;
            emit PieceBridged(it.owner, p.denomination, net, p.precommit);
        }
        totalDeposits++;
        emit Deposited(it.owner, it.gross, fee, n, it.feeRecipient);
    }
}
