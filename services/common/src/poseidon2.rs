//! Poseidon2 (BN254, t = 4, Rf = 8, Rp = 56) — same constants and sponge as Noir's
//! `noir-lang/poseidon` v0.4.0 and `sdk/src/crypto/poseidon2.ts`.
use alloy::primitives::U256;
use serde::Deserialize;
use std::sync::OnceLock;

pub const P: U256 = U256::from_limbs([
    0x43e1f593f0000001,
    0x2833e84879b97091,
    0xb85045b68181585d,
    0x30644e72e131a029,
]);

#[derive(Deserialize)]
struct Round {
    kind: String,
    rc: Vec<String>,
}

#[derive(Deserialize)]
struct Params {
    diag: Vec<String>,
    rounds: Vec<Round>,
}

struct Consts {
    diag: [U256; 4],
    rounds: Vec<(bool, Vec<U256>)>,
}

fn consts() -> &'static Consts {
    static C: OnceLock<Consts> = OnceLock::new();
    C.get_or_init(|| {
        let p: Params = serde_json::from_str(include_str!("../../../sdk/src/crypto/poseidon2-bn254.json"))
            .expect("poseidon2 params");
        let h = |s: &String| U256::from_str_radix(s.trim_start_matches("0x"), 16).unwrap();
        let d: Vec<U256> = p.diag.iter().map(h).collect();
        Consts {
            diag: [d[0], d[1], d[2], d[3]],
            rounds: p.rounds.iter().map(|r| (r.kind == "external", r.rc.iter().map(h).collect())).collect(),
        }
    })
}

#[inline]
fn add(a: U256, b: U256) -> U256 {
    a.add_mod(b, P)
}
#[inline]
fn mul(a: U256, b: U256) -> U256 {
    a.mul_mod(b, P)
}
#[inline]
fn pow5(x: U256) -> U256 {
    let x2 = mul(x, x);
    mul(mul(x2, x2), x)
}

fn mat_external(s: &mut [U256; 4]) {
    let t0 = add(s[0], s[1]);
    let t1 = add(s[2], s[3]);
    let t2 = add(add(s[1], s[1]), t1);
    let t3 = add(add(s[3], s[3]), t0);
    let t4 = add(mul(t1, U256::from(4)), t3);
    let t5 = add(mul(t0, U256::from(4)), t2);
    let t6 = add(t3, t5);
    let t7 = add(t2, t4);
    *s = [t6, t5, t7, t4];
}

fn mat_internal(s: &mut [U256; 4], diag: &[U256; 4]) {
    let sum = add(add(s[0], s[1]), add(s[2], s[3]));
    for i in 0..4 {
        s[i] = add(mul(s[i], diag[i]), sum);
    }
}

pub fn permute(mut s: [U256; 4]) -> [U256; 4] {
    let c = consts();
    for x in s.iter_mut() {
        *x = x.reduce_mod(P);
    }
    mat_external(&mut s);
    for (external, rc) in &c.rounds {
        if *external {
            for i in 0..4 {
                s[i] = pow5(add(s[i], rc[i]));
            }
            mat_external(&mut s);
        } else {
            s[0] = pow5(add(s[0], rc[0]));
            mat_internal(&mut s, &c.diag);
        }
    }
    s
}

/// Noir `Poseidon2::hash(inputs, inputs.len())`.
pub fn hash(inputs: &[U256]) -> U256 {
    let mut state = [U256::ZERO, U256::ZERO, U256::ZERO, U256::from(inputs.len() as u64) << 64];
    let mut cache: Vec<U256> = Vec::with_capacity(3);
    let duplex = |state: &mut [U256; 4], cache: &mut Vec<U256>| {
        for (i, c) in cache.iter().enumerate() {
            state[i] = add(state[i], *c);
        }
        *state = permute(*state);
        cache.clear();
    };
    for x in inputs {
        if cache.len() == 3 {
            duplex(&mut state, &mut cache);
        }
        cache.push(x.reduce_mod(P));
    }
    duplex(&mut state, &mut cache);
    state[0]
}

pub fn hash2(a: U256, b: U256) -> U256 {
    hash(&[a, b])
}

#[cfg(test)]
mod tests {
    use super::*;
    fn h(s: &str) -> U256 {
        U256::from_str_radix(s.trim_start_matches("0x"), 16).unwrap()
    }
    #[test]
    fn matches_noir_vectors() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../../../sdk/test/vectors.json")).unwrap();
        let g = |k: &str| h(v[k].as_str().unwrap());
        assert_eq!(hash2(U256::from(3), U256::from(4)), g("hash2_3_4"));
        assert_eq!(hash2(U256::from(1), U256::from(2)), g("hash2_1_2"));
        assert_eq!(hash(&[U256::from(1), U256::from(42)]), g("owner_42"));
        assert_eq!(hash(&[U256::from(2), g("owner_42"), U256::from(7)]), g("precommit_owner42_7"));
        assert_eq!(
            hash(&[U256::from(4), g("commitment_10usdc_owner42_7"), U256::from(42), U256::from(5)]),
            g("nullifier_above_sk42_idx5")
        );
    }
}
