//! Shared primitives for the Vatanta circuits. Must stay byte-for-byte compatible with
//! `sdk/src/crypto/poseidon2.ts`, `contracts/src/lib/Hashing.sol` and SPEC.md §4.
use poseidon::poseidon2::Poseidon2;

pub mod test_fixture;

pub global DEPTH: u32 = 32;

pub global DOM_OWNER: Field = 1;
pub global DOM_PRE: Field = 2;
pub global DOM_NOTE: Field = 3;
pub global DOM_NULL: Field = 4;

/// 1 USDC = 1_000_000 micro-USDC.
pub global USDC: u64 = 1_000_000;
pub global DENOM_10: u64 = 10 * USDC;
pub global DENOM_100: u64 = 100 * USDC;
pub global DENOM_1K: u64 = 1_000 * USDC;
pub global DENOM_10K: u64 = 10_000 * USDC;

pub struct InNote {
    pub amount: u64,
    pub blinding: Field,
    pub leaf_index: u32,
    pub path: [Field; DEPTH],
}

pub struct OutNote {
    pub amount: u64,
    pub owner: Field,
    pub blinding: Field,
}

pub fn hash2(a: Field, b: Field) -> Field {
    Poseidon2::hash([a, b], 2)
}

pub fn owner_of(sk: Field) -> Field {
    Poseidon2::hash([DOM_OWNER, sk], 2)
}

pub fn precommit(owner: Field, blinding: Field) -> Field {
    Poseidon2::hash([DOM_PRE, owner, blinding], 3)
}

pub fn commitment(amount: u64, owner: Field, blinding: Field) -> Field {
    Poseidon2::hash([DOM_NOTE, amount as Field, precommit(owner, blinding)], 3)
}

pub fn nullifier(commitment: Field, sk: Field, leaf_index: u32) -> Field {
    Poseidon2::hash([DOM_NULL, commitment, sk, leaf_index as Field], 4)
}

/// Root of the depth-32 tree given a leaf, its index and the sibling path (leaf level first).
pub fn merkle_root(leaf: Field, leaf_index: u32, path: [Field; DEPTH]) -> Field {
    let bits: [bool; DEPTH] = (leaf_index as Field).to_le_bits();
    let mut node = leaf;
    for i in 0..DEPTH {
        let (l, r) = if bits[i] { (path[i], node) } else { (node, path[i]) };
        node = hash2(l, r);
    }
    node
}

/// Checks an input note: membership under `root` (skipped for zero-amount dummies) and returns
/// (value, nullifier).
pub fn spend(note: InNote, sk: Field, root: Field) -> (Field, Field) {
    let owner = owner_of(sk);
    let c = commitment(note.amount, owner, note.blinding);
    if note.amount != 0 {
        assert(merkle_root(c, note.leaf_index, note.path) == root, "input note not in tree");
    }
    (note.amount as Field, nullifier(c, sk, note.leaf_index))
}

pub fn is_denomination(a: u64) -> bool {
    (a == DENOM_10) | (a == DENOM_100) | (a == DENOM_1K) | (a == DENOM_10K)
}

// ---------------------------------------------------------------- tests / vectors
#[test]
fn vectors() {
    // Printed values are pinned in sdk/test/vectors.json and contracts/test/Hashing.t.sol.
    println(hash2(1, 2));
    println(owner_of(42));
    println(precommit(owner_of(42), 7));
    println(commitment(10 * USDC, owner_of(42), 7));
    println(nullifier(commitment(10 * USDC, owner_of(42), 7), 42, 5));
}

#[test]
fn merkle_single_leaf() {
    // Tree with only leaf 0 set: path is the zero hashes.
    let mut zeros = [0; DEPTH];
    for i in 1..DEPTH {
        zeros[i] = hash2(zeros[i - 1], zeros[i - 1]);
    }
    let leaf = 123;
    let mut expect = leaf;
    for i in 0..DEPTH {
        expect = hash2(expect, zeros[i]);
    }
    assert(merkle_root(leaf, 0, zeros) == expect);
    // index 1: leaf is the right child at level 0
    let mut p = zeros;
    p[0] = 99;
    let mut e2 = hash2(99, leaf);
    for i in 1..DEPTH {
        e2 = hash2(e2, zeros[i]);
    }
    assert(merkle_root(leaf, 1, p) == e2);
}

#[test]
fn denominations() {
    assert(is_denomination(DENOM_10));
    assert(is_denomination(DENOM_10K));
    assert(!is_denomination(0));
    assert(!is_denomination(20 * USDC));
}
