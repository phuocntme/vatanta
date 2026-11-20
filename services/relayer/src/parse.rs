//! JSON (as sent by sdk/src/relayer-client.ts: bigints as decimal strings) → contract structs.
use crate::error::{ApiError, ApiResult};
use alloy::primitives::{Address, Bytes, B256, U256};
use serde_json::Value;
use vatanta_common::contracts::{DepositRouter, ShieldedPool};

fn bad(m: impl Into<String>) -> ApiError {
    ApiError::BadRequest(m.into())
}

pub fn u256(v: &Value, k: &str) -> ApiResult<U256> {
    match v.get(k) {
        Some(Value::String(s)) => s.parse::<U256>().map_err(|_| bad(format!("{k}: not a uint256"))),
        Some(Value::Number(n)) => Ok(U256::from(n.as_u64().ok_or_else(|| bad(format!("{k}: bad number")))?)),
        _ => Err(bad(format!("missing {k}"))),
    }
}

fn u256_at(v: &Value, i: usize, k: &str) -> ApiResult<U256> {
    match v.get(i) {
        Some(Value::String(s)) => s.parse::<U256>().map_err(|_| bad(format!("{k}[{i}]: not a uint256"))),
        Some(Value::Number(n)) => Ok(U256::from(n.as_u64().unwrap_or_default())),
        _ => Err(bad(format!("missing {k}[{i}]"))),
    }
}

fn arr<const N: usize>(v: &Value, k: &str) -> ApiResult<[U256; N]> {
    let a = v.get(k).and_then(|x| x.as_array()).ok_or_else(|| bad(format!("missing {k}")))?;
    if a.len() != N {
        return Err(bad(format!("{k}: expected {N} items")));
    }
    let mut out = [U256::ZERO; N];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u256_at(&Value::Array(a.clone()), i, k)?;
    }
    Ok(out)
}

pub fn address(v: &Value, k: &str) -> ApiResult<Address> {
    v.get(k).and_then(|x| x.as_str()).and_then(|s| s.parse().ok()).ok_or_else(|| bad(format!("{k}: not an address")))
}

pub fn bytes(s: &str, k: &str) -> ApiResult<Bytes> {
    let h = s.strip_prefix("0x").unwrap_or(s);
    hex::decode(h).map(Bytes::from).map_err(|_| bad(format!("{k}: not hex")))
}

fn notes<const N: usize>(v: &Value) -> ApiResult<[ShieldedPool::NoteData; N]> {
    let a = v.get("notes").and_then(|x| x.as_array()).ok_or_else(|| bad("missing notes"))?;
    if a.len() != N {
        return Err(bad(format!("notes: expected {N}")));
    }
    let mut out: Vec<ShieldedPool::NoteData> = Vec::with_capacity(N);
    for (i, n) in a.iter().enumerate() {
        let ct = n.get("ciphertext").and_then(|x| x.as_str()).ok_or_else(|| bad(format!("notes[{i}].ciphertext")))?;
        let tag = n.get("viewTag").and_then(|x| x.as_u64()).ok_or_else(|| bad(format!("notes[{i}].viewTag")))?;
        out.push(ShieldedPool::NoteData { ciphertext: bytes(ct, "ciphertext")?, viewTag: tag as u8 });
    }
    out.try_into().map_err(|_| bad("notes"))
}

pub fn proof(body: &Value) -> ApiResult<Bytes> {
    let p = body.get("proof").and_then(|x| x.as_str()).ok_or_else(|| bad("missing proof"))?;
    bytes(p, "proof")
}

pub fn transfer_args(a: &Value) -> ApiResult<ShieldedPool::TransferArgs> {
    Ok(ShieldedPool::TransferArgs {
        root: u256(a, "root")?,
        nullifiers: arr::<2>(a, "nullifiers")?,
        commitments: arr::<2>(a, "commitments")?,
        fee: u256(a, "fee")?,
        relayer: address(a, "relayer")?,
        notes: notes::<2>(a)?,
    })
}

pub fn split_args(a: &Value) -> ApiResult<ShieldedPool::SplitArgs> {
    Ok(ShieldedPool::SplitArgs {
        root: u256(a, "root")?,
        nullifiers: arr::<2>(a, "nullifiers")?,
        denomCommitments: arr::<12>(a, "denomCommitments")?,
        changeCommitment: u256(a, "changeCommitment")?,
        fee: u256(a, "fee")?,
        relayer: address(a, "relayer")?,
        notes: notes::<13>(a)?,
    })
}

pub fn withdraw_args(a: &Value) -> ApiResult<ShieldedPool::WithdrawArgs> {
    Ok(ShieldedPool::WithdrawArgs {
        root: u256(a, "root")?,
        nullifier: u256(a, "nullifier")?,
        amount: u256(a, "amount")?,
        recipient: address(a, "recipient")?,
        relayer: address(a, "relayer")?,
        // absent = C-Chain (clients from before SPEC §14)
        destBlockchainId: match a.get("destBlockchainId") {
            None | Some(Value::Null) => B256::ZERO,
            Some(v) => v.as_str().and_then(|x| x.parse().ok()).ok_or_else(|| bad("destBlockchainId"))?,
        },
        destTransferrer: match a.get("destTransferrer") {
            None | Some(Value::Null) => Address::ZERO,
            Some(_) => address(a, "destTransferrer")?,
        },
    })
}

fn sig(v: &Value, k: &str) -> ApiResult<DepositRouter::Sig> {
    let s = v.get(k).ok_or_else(|| bad(format!("missing {k}")))?;
    let b32 = |f: &str| -> ApiResult<B256> {
        s.get(f).and_then(|x| x.as_str()).and_then(|x| x.parse().ok()).ok_or_else(|| bad(format!("{k}.{f}")))
    };
    Ok(DepositRouter::Sig { v: s.get("v").and_then(|x| x.as_u64()).ok_or_else(|| bad(format!("{k}.v")))? as u8, r: b32("r")?, s: b32("s")? })
}

pub fn deposit(body: &Value) -> ApiResult<(DepositRouter::DepositIntent, DepositRouter::Sig, DepositRouter::Sig)> {
    let it = body.get("intent").ok_or_else(|| bad("missing intent"))?;
    let pieces = it.get("pieces").and_then(|x| x.as_array()).ok_or_else(|| bad("intent.pieces"))?;
    let mut ps = Vec::new();
    for p in pieces {
        ps.push(DepositRouter::Piece {
            denomination: u256(p, "denomination")?,
            precommit: p.get("precommit").and_then(|x| x.as_str()).and_then(|x| x.parse().ok()).ok_or_else(|| bad("piece.precommit"))?,
        });
    }
    Ok((
        DepositRouter::DepositIntent {
            owner: address(it, "owner")?,
            gross: u256(it, "gross")?,
            pieces: ps,
            feeRecipient: address(it, "feeRecipient")?,
            nonce: u256(it, "nonce")?,
            deadline: u256(it, "deadline")?,
        },
        sig(body, "permitSig")?,
        sig(body, "intentSig")?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const A: &str = "0x00000000000000000000000000000000000000aa";

    #[test]
    fn withdraw_args_from_sdk_json() {
        let a = withdraw_args(&json!({"root": "123", "nullifier": "456", "amount": "10000000", "recipient": A, "relayer": A})).unwrap();
        assert_eq!(a.root, U256::from(123));
        assert_eq!(a.amount, U256::from(10_000_000u64));
        assert_eq!(a.recipient, A.parse::<Address>().unwrap());
    }

    #[test]
    fn withdraw_args_destination_defaults_to_c_chain_and_parses_l1() {
        let base = json!({"root": "1", "nullifier": "2", "amount": "10000000", "recipient": A, "relayer": A});
        let a = withdraw_args(&base).unwrap();
        assert_eq!(a.destBlockchainId, B256::ZERO);
        assert_eq!(a.destTransferrer, Address::ZERO);
        let mut l1 = base.clone();
        l1["destBlockchainId"] = json!(format!("0x{:0>64}", "ec40"));
        l1["destTransferrer"] = json!(A);
        let a = withdraw_args(&l1).unwrap();
        assert_eq!(a.destBlockchainId, B256::from(U256::from(0xec40)));
        assert_eq!(a.destTransferrer, A.parse::<Address>().unwrap());
        l1["destBlockchainId"] = json!("0x12");
        assert!(withdraw_args(&l1).is_err());
    }

    #[test]
    fn rejects_missing_and_malformed_fields() {
        assert!(withdraw_args(&json!({"root": "1"})).is_err());
        assert!(withdraw_args(&json!({"root": "x", "nullifier": "1", "amount": "1", "recipient": A, "relayer": A})).is_err());
        assert!(withdraw_args(&json!({"root": "1", "nullifier": "1", "amount": "1", "recipient": "0x12", "relayer": A})).is_err());
    }

    #[test]
    fn deposit_intent_and_signatures() {
        let sig = json!({"v": 27, "r": format!("0x{}", "11".repeat(32)), "s": format!("0x{}", "22".repeat(32))});
        let body = json!({
            "intent": {"owner": A, "gross": "20000000", "feeRecipient": A, "nonce": "0", "deadline": "9999999999",
                       "pieces": [{"denomination": "10000000", "precommit": format!("0x{}", "33".repeat(32))},
                                  {"denomination": "10000000", "precommit": format!("0x{}", "44".repeat(32))}]},
            "permitSig": sig, "intentSig": sig,
        });
        let (it, ps, _) = deposit(&body).unwrap();
        assert_eq!(it.pieces.len(), 2);
        assert_eq!(it.gross, U256::from(20_000_000u64));
        assert_eq!(ps.v, 27);
        assert!(deposit(&json!({"intent": {"owner": A}})).is_err());
    }
}
