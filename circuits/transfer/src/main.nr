//! transfer: 2 notes in, 2 notes out (recipient + change), public fee paid to `relayer`.
//! Public inputs (in this order): root, nullifiers[2], out_commitments[2], fee, relayer,
//! chain_id, pool, ext_data_hash. See SPEC.md §4.6.
use vatanta_lib::{commitment, InNote, OutNote, spend};

fn main(
    root: pub Field,
    nullifiers: pub [Field; 2],
    out_commitments: pub [Field; 2],
    fee: pub u64,
    relayer: pub Field,
    chain_id: pub Field,
    pool: pub Field,
    ext_data_hash: pub Field,
    sk: Field,
    inputs: [InNote; 2],
    outputs: [OutNote; 2],
) {
    let (v0, n0) = spend(inputs[0], sk, root);
    let (v1, n1) = spend(inputs[1], sk, root);
    assert(n0 == nullifiers[0], "nullifier 0");
    assert(n1 == nullifiers[1], "nullifier 1");
    assert(n0 != n1, "duplicate input");

    let mut out_sum = 0;
    for i in 0..2 {
        let o = outputs[i];
        assert(commitment(o.amount, o.owner, o.blinding) == out_commitments[i], "output commitment");
        out_sum += o.amount as Field;
    }
    // All amounts are u64, so these Field sums cannot wrap.
    assert(v0 + v1 == out_sum + fee as Field, "value not conserved");

    // Bind context-only public inputs (they are also bound by the proof transcript).
    let _ = (relayer, chain_id, pool, ext_data_hash);
}

#[test]
fn transfer_happy_path() {
    let t = vatanta_lib::test_fixture::transfer_case(1);
    main(
        t.root, t.nullifiers, t.out_commitments, t.fee, 7, 777001, 9, 11, t.sk, t.inputs, t.outputs,
    );
}

#[test(should_fail_with = "value not conserved")]
fn transfer_inflation_rejected() {
    let mut t = vatanta_lib::test_fixture::transfer_case(1);
    // claim a bigger recipient output than the inputs cover
    t.outputs[0].amount += 1;
    t.out_commitments[0] =
        commitment(t.outputs[0].amount, t.outputs[0].owner, t.outputs[0].blinding);
    main(
        t.root, t.nullifiers, t.out_commitments, t.fee, 7, 777001, 9, 11, t.sk, t.inputs, t.outputs,
    );
}

#[test(should_fail_with = "input note not in tree")]
fn transfer_wrong_key_rejected() {
    let t = vatanta_lib::test_fixture::transfer_case(1);
    main(
        t.root, t.nullifiers, t.out_commitments, t.fee, 7, 777001, 9, 11, t.sk + 1, t.inputs,
        t.outputs,
    );
}
