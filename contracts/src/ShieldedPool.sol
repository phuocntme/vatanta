// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {MerkleTree} from "./lib/MerkleTree.sol";
import {Field} from "./lib/Field.sol";
import {VerifierRegistry} from "./VerifierRegistry.sol";
import {IERC20Like} from "./interfaces/IERC20Like.sol";
import {IERC20SendAndCallReceiver, IERC20TokenTransferrer, SendTokensInput} from "./interfaces/IICTT.sol";

/// Shielded USDC pool on the Vatanta L1 (SPEC.md §4–§5).
///
/// Value enters only through ICTT `sendAndCall` from the C-Chain `DepositRouter`, moves privately
/// through `transfer` / `split` proofs, and leaves through `withdraw` proofs that bridge USDC back
/// to a recipient on C-Chain or, through ICTT multi-hop via C-Chain, on any L1 whose TokenRemote is
/// registered with our TokenHome (SPEC §14). Every proof binds chain id, this pool's address and the
/// relayer; a withdraw proof also binds its destination through `ext_data_hash`.
contract ShieldedPool is MerkleTree, IERC20SendAndCallReceiver {
    // ------------------------------------------------------------------ parameters (locked)
    uint256 public constant USDC = 1e6;
    uint256 public constant SEND_FEE = 100_000; // 0.10 USDC
    uint256 public constant FEE_BPS = 25; // 0.25 %
    uint256 public constant MAX_PIECES = 12;
    uint256 public constant SPLIT_OUTPUTS = MAX_PIECES + 1;
    uint256 public constant MAX_CIPHERTEXT = 256;
    /// gas ICM relayer must give the C-Chain TokenHome when releasing a withdrawal
    uint256 public constant WITHDRAW_REQUIRED_GAS = 250_000;

    // ------------------------------------------------------------------ wiring
    IERC20Like public immutable token; // bridged USDC (ICTT ERC20TokenRemote on this L1)
    bytes32 public immutable homeBlockchainId; // C-Chain blockchain id
    address public immutable tokenHome; // ICTT ERC20TokenHome on C-Chain
    address public immutable depositRouter; // DepositRouter on C-Chain
    VerifierRegistry public immutable registry;
    bytes32 public immutable transferVk;
    bytes32 public immutable splitVk;
    bytes32 public immutable withdrawVk;

    // ------------------------------------------------------------------ state
    mapping(uint256 => bool) public nullifierSpent;
    /// net-deposit counts per gross denomination (10e6, 100e6, 1000e6, 10000e6)
    mapping(uint256 => uint256) public depositCount;
    mapping(uint256 => uint256) public withdrawCount;
    uint256 public totalTransfers;

    struct NoteData {
        bytes ciphertext;
        uint8 viewTag;
    }

    struct TransferArgs {
        uint256 root;
        uint256[2] nullifiers;
        uint256[2] commitments;
        uint256 fee;
        address relayer;
        NoteData[2] notes;
    }

    struct SplitArgs {
        uint256 root;
        uint256[2] nullifiers;
        uint256[MAX_PIECES] denomCommitments; // 0 = empty slot
        uint256 changeCommitment;
        uint256 fee;
        address relayer;
        NoteData[SPLIT_OUTPUTS] notes; // [denom slots..., change]
    }

    struct WithdrawArgs {
        uint256 root;
        uint256 nullifier;
        uint256 amount; // gross denomination, micro-USDC
        address recipient; // on the destination chain
        address relayer;
        /// 0 = C-Chain. Otherwise the destination L1's blockchain id and its ICTT TokenRemote.
        bytes32 destBlockchainId;
        address destTransferrer;
    }

    // ------------------------------------------------------------------ events
    event Deposit(uint32 indexed leafIndex, uint256 commitment, uint256 amount, uint256 denomination, uint256 precommit);
    event NoteCommitted(uint32 indexed leafIndex, uint256 commitment, uint8 viewTag, bytes ciphertext);
    event NullifierSpent(uint256 indexed nullifier);
    event Transfer(uint256 nullifier0, uint256 nullifier1, address indexed relayer, uint256 fee);
    event Split(uint256 nullifier0, uint256 nullifier1, uint256 pieces, address indexed relayer, uint256 fee);
    /// `destination` = 0 for C-Chain, else the destination L1's blockchain id.
    event Withdrawal(
        uint256 indexed nullifier,
        uint256 denomination,
        address recipient,
        address indexed relayer,
        uint256 fee,
        bytes32 destination,
        address destTransferrer
    );

    // ------------------------------------------------------------------ errors
    error OnlyTokenRemote();
    error WrongSource();
    error BadDepositAmount(uint256 amount);
    error BadPayload();
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

    constructor(
        IERC20Like token_,
        bytes32 homeBlockchainId_,
        address tokenHome_,
        address depositRouter_,
        VerifierRegistry registry_,
        bytes32 transferVk_,
        bytes32 splitVk_,
        bytes32 withdrawVk_
    ) {
        token = token_;
        homeBlockchainId = homeBlockchainId_;
        tokenHome = tokenHome_;
        depositRouter = depositRouter_;
        registry = registry_;
        transferVk = transferVk_;
        splitVk = splitVk_;
        withdrawVk = withdrawVk_;
    }

    // ================================================================== deposit (ICTT)

    /// Net amount the pool accepts for a gross denomination: d − 0.25 %.
    function netOf(uint256 denomination) public pure returns (uint256) {
        return denomination - (denomination * FEE_BPS) / 10_000;
    }

    function isDenomination(uint256 a) public pure returns (bool) {
        return a == 10 * USDC || a == 100 * USDC || a == 1_000 * USDC || a == 10_000 * USDC;
    }

    /// Maps a net deposit amount back to its gross denomination, or 0 if not allowed.
    function denominationOfNet(uint256 net) public pure returns (uint256) {
        if (net == netOf(10 * USDC)) return 10 * USDC;
        if (net == netOf(100 * USDC)) return 100 * USDC;
        if (net == netOf(1_000 * USDC)) return 1_000 * USDC;
        if (net == netOf(10_000 * USDC)) return 10_000 * USDC;
        return 0;
    }

    function receiveTokens(
        bytes32 sourceBlockchainID,
        address originTokenTransferrerAddress,
        address originSenderAddress,
        address token_,
        uint256 amount,
        bytes calldata payload
    ) external override {
        if (msg.sender != address(token) || token_ != address(token)) revert OnlyTokenRemote();
        if (
            sourceBlockchainID != homeBlockchainId || originTokenTransferrerAddress != tokenHome
                || originSenderAddress != depositRouter
        ) revert WrongSource();
        uint256 d = denominationOfNet(amount);
        if (d == 0) revert BadDepositAmount(amount);
        if (payload.length != 32) revert BadPayload();
        uint256 precommit = abi.decode(payload, (uint256));
        if (precommit == 0 || precommit >= Field.P) revert BadPayload();

        if (!token.transferFrom(msg.sender, address(this), amount)) revert TokenTransferFailed();

        uint256 c = Field.noteCommitment(amount, precommit);
        uint256[] memory leaves = new uint256[](1);
        leaves[0] = c;
        uint32 idx = _insert(leaves);
        depositCount[d]++;
        emit Deposit(idx, c, amount, d, precommit);
    }

    // ================================================================== private transfer

    function transfer(bytes calldata proof, TransferArgs calldata a) external {
        if (a.fee != SEND_FEE) revert WrongFee();
        _checkRoot(a.root);
        _spend(a.nullifiers[0], a.nullifiers[1]);

        NoteData[] memory notes = new NoteData[](2);
        notes[0] = a.notes[0];
        notes[1] = a.notes[1];
        uint256 ext = _extDataHash(notes);

        bytes32[] memory pi = new bytes32[](10);
        pi[0] = bytes32(a.root);
        pi[1] = bytes32(a.nullifiers[0]);
        pi[2] = bytes32(a.nullifiers[1]);
        pi[3] = bytes32(a.commitments[0]);
        pi[4] = bytes32(a.commitments[1]);
        pi[5] = bytes32(a.fee);
        pi[6] = bytes32(uint256(uint160(a.relayer)));
        pi[7] = bytes32(block.chainid);
        pi[8] = bytes32(uint256(uint160(address(this))));
        pi[9] = bytes32(ext);
        if (!registry.verify(transferVk, proof, pi)) revert InvalidProof();

        uint256[] memory leaves = new uint256[](2);
        leaves[0] = a.commitments[0];
        leaves[1] = a.commitments[1];
        _commitNotes(leaves, notes);
        totalTransfers++;
        _pay(a.relayer, a.fee);
        emit Transfer(a.nullifiers[0], a.nullifiers[1], a.relayer, a.fee);
    }

    // ================================================================== split before withdraw

    function split(bytes calldata proof, SplitArgs calldata a) external {
        if (a.fee != SEND_FEE) revert WrongFee();
        _checkRoot(a.root);
        _spend(a.nullifiers[0], a.nullifiers[1]);

        NoteData[] memory allNotes = new NoteData[](SPLIT_OUTPUTS);
        for (uint256 i = 0; i < SPLIT_OUTPUTS; i++) {
            allNotes[i] = a.notes[i];
        }
        uint256 ext = _extDataHash(allNotes);

        bytes32[] memory pi = new bytes32[](21);
        pi[0] = bytes32(a.root);
        pi[1] = bytes32(a.nullifiers[0]);
        pi[2] = bytes32(a.nullifiers[1]);
        uint256 pieces;
        for (uint256 i = 0; i < MAX_PIECES; i++) {
            pi[3 + i] = bytes32(a.denomCommitments[i]);
            if (a.denomCommitments[i] != 0) pieces++;
        }
        pi[15] = bytes32(a.changeCommitment);
        pi[16] = bytes32(a.fee);
        pi[17] = bytes32(uint256(uint160(a.relayer)));
        pi[18] = bytes32(block.chainid);
        pi[19] = bytes32(uint256(uint160(address(this))));
        pi[20] = bytes32(ext);
        if (!registry.verify(splitVk, proof, pi)) revert InvalidProof();

        uint256[] memory leaves = new uint256[](pieces + 1);
        NoteData[] memory notes = new NoteData[](pieces + 1);
        uint256 j;
        for (uint256 i = 0; i < MAX_PIECES; i++) {
            if (a.denomCommitments[i] != 0) {
                leaves[j] = a.denomCommitments[i];
                notes[j] = a.notes[i];
                j++;
            }
        }
        leaves[j] = a.changeCommitment;
        notes[j] = a.notes[MAX_PIECES];
        _commitNotes(leaves, notes);
        totalTransfers++;
        _pay(a.relayer, a.fee);
        emit Split(a.nullifiers[0], a.nullifiers[1], pieces, a.relayer, a.fee);
    }

    // ================================================================== withdraw (C-Chain or another L1)

    function withdraw(bytes calldata proof, WithdrawArgs calldata a) external {
        if (!isDenomination(a.amount)) revert NotADenomination(a.amount);
        if (a.recipient == address(0)) revert ZeroRecipient();
        bool toL1 = a.destBlockchainId != bytes32(0);
        if (toL1 ? (a.destBlockchainId == homeBlockchainId || a.destTransferrer == address(0)) : a.destTransferrer != address(0)) {
            revert BadDestination();
        }
        _checkRoot(a.root);
        if (nullifierSpent[a.nullifier]) revert NullifierAlreadySpent(a.nullifier);
        nullifierSpent[a.nullifier] = true;
        emit NullifierSpent(a.nullifier);

        bytes32[] memory pi = new bytes32[](8);
        pi[0] = bytes32(a.root);
        pi[1] = bytes32(a.nullifier);
        pi[2] = bytes32(a.amount);
        pi[3] = bytes32(uint256(uint160(a.recipient)));
        pi[4] = bytes32(uint256(uint160(a.relayer)));
        pi[5] = bytes32(block.chainid);
        pi[6] = bytes32(uint256(uint160(address(this))));
        pi[7] = bytes32(withdrawExtDataHash(a.destBlockchainId, a.destTransferrer));
        if (!registry.verify(withdrawVk, proof, pi)) revert InvalidProof();

        uint256 fee = (a.amount * FEE_BPS) / 10_000;
        uint256 net = a.amount - fee;
        withdrawCount[a.amount]++;
        _pay(a.relayer, fee);
        if (!token.approve(address(token), net)) revert TokenTransferFailed();
        // C-Chain: one hop to the TokenHome. Another L1: ICTT multi-hop through the TokenHome; if that
        // L1's TokenRemote is not registered (or not collateralized) the home pays `recipient` on
        // C-Chain instead (`multiHopFallback`), and the recipient's key controls that address too.
        IERC20TokenTransferrer(address(token)).send(
            SendTokensInput({
                destinationBlockchainID: toL1 ? a.destBlockchainId : homeBlockchainId,
                destinationTokenTransferrerAddress: toL1 ? a.destTransferrer : tokenHome,
                recipient: a.recipient,
                primaryFeeTokenAddress: address(token),
                primaryFee: 0,
                secondaryFee: 0,
                requiredGasLimit: WITHDRAW_REQUIRED_GAS,
                multiHopFallback: toL1 ? a.recipient : address(0)
            }),
            net
        );
        emit Withdrawal(a.nullifier, a.amount, a.recipient, a.relayer, fee, a.destBlockchainId, a.destTransferrer);
    }

    // ================================================================== views

    /// Public inputs hash for ext data, exposed so clients can check their encoding.
    function extDataHash(NoteData[] calldata notes) external pure returns (uint256) {
        return _extDataHash(notes);
    }

    /// ext_data_hash of a withdraw proof: 0 for C-Chain (as before §14), else
    /// keccak256(abi.encode(destBlockchainId, destTransferrer)) mod p, so a relayer cannot redirect it.
    function withdrawExtDataHash(bytes32 destBlockchainId, address destTransferrer) public pure returns (uint256) {
        if (destBlockchainId == bytes32(0) && destTransferrer == address(0)) return 0;
        return Field.toField(keccak256(abi.encode(destBlockchainId, destTransferrer)));
    }

    // ================================================================== internals

    function _checkRoot(uint256 root) internal view {
        if (!isKnownRoot(root)) revert UnknownRoot();
    }

    function _spend(uint256 n0, uint256 n1) internal {
        if (n0 == n1) revert DuplicateNullifier();
        if (nullifierSpent[n0]) revert NullifierAlreadySpent(n0);
        if (nullifierSpent[n1]) revert NullifierAlreadySpent(n1);
        nullifierSpent[n0] = true;
        nullifierSpent[n1] = true;
        emit NullifierSpent(n0);
        emit NullifierSpent(n1);
    }

    function _extDataHash(NoteData[] memory notes) internal pure returns (uint256) {
        for (uint256 i = 0; i < notes.length; i++) {
            if (notes[i].ciphertext.length > MAX_CIPHERTEXT) revert CiphertextTooLong();
        }
        return Field.toField(keccak256(abi.encode(notes)));
    }

    function _commitNotes(uint256[] memory leaves, NoteData[] memory notes) internal {
        uint32 start = _insert(leaves);
        for (uint256 i = 0; i < leaves.length; i++) {
            emit NoteCommitted(start + uint32(i), leaves[i], notes[i].viewTag, notes[i].ciphertext);
        }
    }

    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (!token.transfer(to, amount)) revert TokenTransferFailed();
    }
}
