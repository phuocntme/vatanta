//! withdraw: 1 denomination note in, public amount out to `recipient` on C-Chain.
//! Public inputs: root, nullifier, amount, recipient, relayer, chain_id, pool, ext_data_hash.
use vatanta_lib::{InNote, is_denomination, spend};

fn main(
    root: pub Field,
    nullifier: pub Field,
    amount: pub u64,
    recipient: pub Field,
    relayer: pub Field,
    chain_id: pub Field,
    pool: pub Field,
    ext_data_hash: pub Field,
    sk: Field,
    input: InNote,
) {
    assert(is_denomination(amount), "not a denomination");
    assert(input.amount == amount, "amount mismatch");
    let (_, n) = spend(input, sk, root);
    assert(n == nullifier, "nullifier");
    let _ = (recipient, relayer, chain_id, pool, ext_data_hash);
}

#[test]
fn withdraw_happy_path() {
    let t = vatanta_lib::test_fixture::withdraw_case();
    main(t.root, t.nullifier, t.amount, 0xbeef, 7, 777001, 9, 11, t.sk, t.input);
}

#[test(should_fail_with = "not a denomination")]
fn withdraw_non_denomination_rejected() {
    let mut t = vatanta_lib::test_fixture::withdraw_case();
    t.amount = 20 * vatanta_lib::USDC;
    main(t.root, t.nullifier, t.amount, 0xbeef, 7, 777001, 9, 11, t.sk, t.input);
}
