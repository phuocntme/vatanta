//! split: 2 notes in, up to 12 denomination notes (owned by the spender) + 1 change note out,
//! one send fee. Empty denomination slots have amount 0 and public commitment 0.
//! Public inputs: root, nullifiers[2], denom_commitments[12], change_commitment, fee, relayer,
//! chain_id, pool, ext_data_hash.
use vatanta_lib::{commitment, InNote, is_denomination, owner_of, spend};

global MAX_PIECES: u32 = 12;

fn main(
    root: pub Field,
    nullifiers: pub [Field; 2],
    denom_commitments: pub [Field; MAX_PIECES],
    change_commitment: pub Field,
    fee: pub u64,
    relayer: pub Field,
    chain_id: pub Field,
    pool: pub Field,
    ext_data_hash: pub Field,
    sk: Field,
    inputs: [InNote; 2],
    denom_amounts: [u64; MAX_PIECES],
    denom_blindings: [Field; MAX_PIECES],
    change_amount: u64,
    change_owner: Field,
    change_blinding: Field,
) {
    let (v0, n0) = spend(inputs[0], sk, root);
    let (v1, n1) = spend(inputs[1], sk, root);
    assert(n0 == nullifiers[0], "nullifier 0");
    assert(n1 == nullifiers[1], "nullifier 1");
    assert(n0 != n1, "duplicate input");

    let owner = owner_of(sk);
    let mut out_sum = 0;
    for i in 0..MAX_PIECES {
        let a = denom_amounts[i];
        if a == 0 {
            assert(denom_commitments[i] == 0, "empty slot must be 0");
        } else {
            assert(is_denomination(a), "not a denomination");
            assert(
                commitment(a, owner, denom_blindings[i]) == denom_commitments[i],
                "denomination commitment",
            );
        }
        out_sum += a as Field;
    }
    assert(
        commitment(change_amount, change_owner, change_blinding) == change_commitment,
        "change commitment",
    );
    out_sum += change_amount as Field;
    assert(v0 + v1 == out_sum + fee as Field, "value not conserved");
    let _ = (relayer, chain_id, pool, ext_data_hash);
}

#[test]
fn split_happy_path() {
    let t = vatanta_lib::test_fixture::split_case();
    main(
        t.root, t.nullifiers, t.denom_commitments, t.change_commitment, t.fee, 7, 777001, 9, 11,
        t.sk, t.inputs, t.denom_amounts, t.denom_blindings, t.change_amount, t.change_owner,
        t.change_blinding,
    );
}

#[test(should_fail_with = "not a denomination")]
fn split_bad_denomination_rejected() {
    let mut t = vatanta_lib::test_fixture::split_case();
    // turn 10 + 10 into one 20 piece
    t.denom_amounts[1] = 0;
    t.denom_commitments[1] = 0;
    t.denom_amounts[0] = 20 * vatanta_lib::USDC;
    t.denom_commitments[0] =
        commitment(t.denom_amounts[0], vatanta_lib::owner_of(t.sk), t.denom_blindings[0]);
    main(
        t.root, t.nullifiers, t.denom_commitments, t.change_commitment, t.fee, 7, 777001, 9, 11,
        t.sk, t.inputs, t.denom_amounts, t.denom_blindings, t.change_amount, t.change_owner,
        t.change_blinding,
    );
}
