//! Deterministic witnesses for circuit unit tests (not used by the provers).
use crate::{commitment, DEPTH, hash2, InNote, merkle_root, nullifier, OutNote, owner_of, USDC};

pub fn zeros() -> [Field; DEPTH] {
    let mut z = [0; DEPTH];
    for i in 1..DEPTH {
        z[i] = hash2(z[i - 1], z[i - 1]);
    }
    z
}

/// Two-leaf tree: returns (root, path for leaf 0, path for leaf 1).
pub fn two_leaf_tree(l0: Field, l1: Field) -> (Field, [Field; DEPTH], [Field; DEPTH]) {
    let z = zeros();
    let mut p0 = z;
    p0[0] = l1;
    let mut p1 = z;
    p1[0] = l0;
    (merkle_root(l0, 0, p0), p0, p1)
}

pub fn dummy_in(blinding: Field) -> InNote {
    InNote { amount: 0, blinding, leaf_index: 0, path: zeros() }
}

pub struct TransferCase {
    pub root: Field,
    pub nullifiers: [Field; 2],
    pub out_commitments: [Field; 2],
    pub fee: u64,
    pub sk: Field,
    pub inputs: [InNote; 2],
    pub outputs: [OutNote; 2],
}

pub fn transfer_case(_seed: Field) -> TransferCase {
    let sk = 42;
    let me = owner_of(sk);
    let a0 = 30 * USDC;
    let a1 = 20 * USDC;
    let c0 = commitment(a0, me, 1001);
    let c1 = commitment(a1, me, 1002);
    let (root, p0, p1) = two_leaf_tree(c0, c1);
    let inputs = [
        InNote { amount: a0, blinding: 1001, leaf_index: 0, path: p0 },
        InNote { amount: a1, blinding: 1002, leaf_index: 1, path: p1 },
    ];
    let fee = 100_000; // 0.10 USDC
    let bob = owner_of(777);
    let outputs = [
        OutNote { amount: 25 * USDC, owner: bob, blinding: 2001 },
        OutNote { amount: a0 + a1 - 25 * USDC - fee, owner: me, blinding: 2002 },
    ];
    TransferCase {
        root,
        nullifiers: [nullifier(c0, sk, 0), nullifier(c1, sk, 1)],
        out_commitments: [
            commitment(outputs[0].amount, outputs[0].owner, outputs[0].blinding),
            commitment(outputs[1].amount, outputs[1].owner, outputs[1].blinding),
        ],
        fee,
        sk,
        inputs,
        outputs,
    }
}

pub struct SplitCase {
    pub root: Field,
    pub nullifiers: [Field; 2],
    pub denom_commitments: [Field; 12],
    pub change_commitment: Field,
    pub fee: u64,
    pub sk: Field,
    pub inputs: [InNote; 2],
    pub denom_amounts: [u64; 12],
    pub denom_blindings: [Field; 12],
    pub change_amount: u64,
    pub change_owner: Field,
    pub change_blinding: Field,
}

pub fn split_case() -> SplitCase {
    let sk = 42;
    let me = owner_of(sk);
    let a0 = 2400 * USDC;
    let c0 = commitment(a0, me, 3001);
    let (root, p0, _) = two_leaf_tree(c0, 5);
    let dummy = dummy_in(3002);
    let dummy_c = commitment(0, me, 3002);
    let k = 1_000 * USDC;
    let h = 100 * USDC;
    let t = 10 * USDC;
    let denom_amounts = [k, k, h, h, h, t, t, t, t, t, 0, 0];
    let mut denom_blindings = [0; 12];
    let mut denom_commitments = [0; 12];
    for i in 0..12 {
        denom_blindings[i] = 4000 + i as Field;
        if denom_amounts[i] != 0 {
            denom_commitments[i] = commitment(denom_amounts[i], me, denom_blindings[i]);
        }
    }
    let fee = 100_000;
    let change_amount = a0 - 2350 * USDC - fee;
    SplitCase {
        root,
        nullifiers: [nullifier(c0, sk, 0), nullifier(dummy_c, sk, 0)],
        denom_commitments,
        change_commitment: commitment(change_amount, me, 5001),
        fee,
        sk,
        inputs: [InNote { amount: a0, blinding: 3001, leaf_index: 0, path: p0 }, dummy],
        denom_amounts,
        denom_blindings,
        change_amount,
        change_owner: me,
        change_blinding: 5001,
    }
}

pub struct WithdrawCase {
    pub root: Field,
    pub nullifier: Field,
    pub amount: u64,
    pub sk: Field,
    pub input: InNote,
}

pub fn withdraw_case() -> WithdrawCase {
    let sk = 42;
    let me = owner_of(sk);
    let a = 100 * USDC;
    let c = commitment(a, me, 6001);
    let (root, _, p1) = two_leaf_tree(9, c);
    WithdrawCase {
        root,
        nullifier: nullifier(c, sk, 1),
        amount: a,
        sk,
        input: InNote { amount: a, blinding: 6001, leaf_index: 1, path: p1 },
    }
}
