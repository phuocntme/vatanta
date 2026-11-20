use crate::{
    error::{ApiError, ApiResult},
    parse,
    scheduler::{next_batch, now},
    AppState,
};
use alloy::primitives::U256;
use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use sqlx::Row;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

type S = State<Arc<AppState>>;
pub const SEND_FEE: u64 = 100_000;
pub const FEE_BPS: u64 = 25;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/v1/info", get(info))
        .route("/v1/transfer", post(transfer))
        .route("/v1/send", post(transfer))
        .route("/send", post(transfer))
        .route("/v1/split", post(split))
        .route("/v1/withdraw", post(withdraw))
        .route("/withdraw", post(withdraw))
        .route("/v1/withdraw/schedule", post(schedule).get(schedule_status))
        .route("/v1/deposit-address", post(deposit_address))
        .route("/deposit-address", post(deposit_address))
        .route("/v1/deposit-address/{addr}", get(deposit_status))
        .route("/v1/batches", get(batches))
        .route("/v1/faucet", post(faucet))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn info(State(s): S) -> Json<Value> {
    // A C-Chain RPC hiccup must not take /v1/info down: C-Chain stays available without the list.
    let destinations = match s.chain.destinations().await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("destination registry: {e}");
            vec![]
        }
    };
    Json(json!({
        "destinationRegistry": s.chain.dep.destination_registry,
        "destinations": destinations,
        "relayer": s.chain.address,
        "chainId": s.chain.dep.l1_chain_id,
        "cChainId": s.chain.dep.c_chain_id,
        "pool": s.chain.dep.shielded_pool,
        "depositRouter": s.chain.dep.deposit_router,
        "usdc": s.chain.dep.usdc,
        "sendFee": SEND_FEE.to_string(),
        "feeBps": FEE_BPS,
        "batchIntervalSecs": s.cfg.batch_interval,
        "nextBatch": next_batch(now(), s.cfg.batch_interval),
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

/// HTTP 402 payment requirements. The in-proof fee is the source of truth.
fn payment_required(s: &AppState, resource: &str, amount: String, kind: &str) -> ApiError {
    ApiError::PaymentRequired(json!({
        "version": 1,
        "accepts": [{
            "scheme": "vatanta-shielded-fee",
            "network": format!("avalanche-l1:{}", s.chain.dep.l1_chain_id),
            "asset": "USDC",
            "maxAmountRequired": amount,
            "payTo": s.chain.address,
            "resource": resource,
            "description": format!("{kind}: the fee is a public input of the zero-knowledge proof, paid by the pool to payTo"),
            "extra": {"pool": s.chain.dep.shielded_pool, "chainId": s.chain.dep.l1_chain_id, "relayer": s.chain.address, "feeBps": FEE_BPS}
        }]
    }))
}

fn needs_payment(body: &Value) -> bool {
    body.get("proof").is_none()
}

fn check_relayer(s: &AppState, a: alloy::primitives::Address) -> ApiResult<()> {
    if a != s.chain.address {
        return Err(ApiError::WrongRelayer(format!("{a:#x}")));
    }
    Ok(())
}

async fn record(s: &AppState, tx: &str, kind: &str) {
    let _ = sqlx::query("insert into submissions (tx, kind) values ($1,$2) on conflict do nothing").bind(tx).bind(kind).execute(&s.db).await;
}

async fn transfer(State(s): S, body: Option<Json<Value>>) -> ApiResult<Json<Value>> {
    let body = body.map(|b| b.0).unwrap_or(Value::Null);
    if needs_payment(&body) {
        return Err(payment_required(&s, "/v1/transfer", SEND_FEE.to_string(), "private send"));
    }
    let proof = parse::proof(&body)?;
    let a = parse::transfer_args(body.get("args").unwrap_or(&Value::Null))?;
    check_relayer(&s, a.relayer)?;
    if a.fee != U256::from(SEND_FEE) {
        return Err(ApiError::WrongFee(SEND_FEE.to_string()));
    }
    s.chain.simulate_transfer(&proof, &a).await?;
    let r = s.chain.transfer(proof, a).await?;
    record(&s, &format!("{:#x}", r.tx_hash), "transfer").await;
    Ok(Json(serde_json::to_value(r).unwrap()))
}

async fn split(State(s): S, body: Option<Json<Value>>) -> ApiResult<Json<Value>> {
    let body = body.map(|b| b.0).unwrap_or(Value::Null);
    if needs_payment(&body) {
        return Err(payment_required(&s, "/v1/split", SEND_FEE.to_string(), "split before withdraw"));
    }
    let proof = parse::proof(&body)?;
    let a = parse::split_args(body.get("args").unwrap_or(&Value::Null))?;
    check_relayer(&s, a.relayer)?;
    if a.fee != U256::from(SEND_FEE) {
        return Err(ApiError::WrongFee(SEND_FEE.to_string()));
    }
    s.chain.simulate_split(&proof, &a).await?;
    let r = s.chain.split(proof, a).await?;
    record(&s, &format!("{:#x}", r.tx_hash), "split").await;
    Ok(Json(serde_json::to_value(r).unwrap()))
}

/// Immediate withdraw (= "Fast" for a single piece).
async fn withdraw(State(s): S, body: Option<Json<Value>>) -> ApiResult<Json<Value>> {
    let body = body.map(|b| b.0).unwrap_or(Value::Null);
    if needs_payment(&body) {
        return Err(payment_required(&s, "/v1/withdraw", "0.25%".into(), "withdraw (0.25% of the piece)"));
    }
    let proof = parse::proof(&body)?;
    let a = parse::withdraw_args(body.get("args").unwrap_or(&Value::Null))?;
    check_relayer(&s, a.relayer)?;
    s.chain.simulate_withdraw(&proof, &a).await?;
    let r = s.chain.withdraw(proof, a).await?;
    Ok(Json(serde_json::to_value(r).unwrap()))
}

/// Accepts pieces with client-chosen batch times; each is verified now (eth_call) and stored.
async fn schedule(State(s): S, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    let pieces = body.get("pieces").and_then(|x| x.as_array()).ok_or_else(|| ApiError::BadRequest("missing pieces".into()))?;
    if pieces.is_empty() || pieces.len() > 12 {
        return Err(ApiError::BadRequest("1..12 pieces".into()));
    }
    let interval = s.cfg.batch_interval;
    let t = now();
    let mut ids = Vec::new();
    for p in pieces {
        let batch = p.get("batch").and_then(|x| x.as_i64()).ok_or_else(|| ApiError::BadRequest("piece.batch".into()))?;
        // must be a boundary, not in the past (one interval of slack), at most 24h + one interval ahead
        if batch % interval != 0 || batch < t - interval || batch > t + 24 * 3600 + 2 * interval {
            return Err(ApiError::BadBatch(batch));
        }
        let proof = parse::proof(p)?;
        let args_v = p.get("args").cloned().unwrap_or(Value::Null);
        let a = parse::withdraw_args(&args_v)?;
        check_relayer(&s, a.relayer)?;
        s.chain.simulate_withdraw(&proof, &a).await?;
        let id: i64 = sqlx::query_scalar("insert into scheduled (batch, nullifier, proof, args) values ($1,$2,$3,$4) on conflict (nullifier) do update set batch = excluded.batch returning id")
            .bind(batch)
            .bind(a.nullifier.to_string())
            .bind(format!("0x{}", hex::encode(&proof)))
            .bind(&args_v)
            .fetch_one(&s.db)
            .await
            .map_err(|e| ApiError::Internal(e.into()))?;
        ids.push(id.to_string());
    }
    Ok(Json(json!({"ids": ids, "nextBatch": next_batch(t, interval)})))
}

async fn schedule_status(State(s): S) -> ApiResult<Json<Value>> {
    let pending: i64 = sqlx::query_scalar("select count(*) from scheduled where status='queued'").fetch_one(&s.db).await.map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(json!({"pending": pending, "nextBatch": next_batch(now(), s.cfg.batch_interval)})))
}

async fn deposit_address(State(s): S, body: Option<Json<Value>>) -> ApiResult<Json<Value>> {
    let body = body.map(|b| b.0).unwrap_or(Value::Null);
    if body.get("intent").is_none() {
        return Err(payment_required(&s, "/v1/deposit-address", "0.25%".into(), "deposit (0.25% per piece, taken by DepositRouter)"));
    }
    let (it, _, _) = parse::deposit(&body)?;
    if it.feeRecipient != s.chain.address {
        return Err(ApiError::WrongRelayer(format!("{:#x}", it.feeRecipient)));
    }
    let addr = format!("{:#x}", it.owner);
    // A finished address can be registered again with a new intent: USDC sent to it a second time
    // (e.g. a wallet restored on a new device reused the address) would otherwise stay stuck there.
    // Safe: the intent is signed by the address's own key and DepositRouter refuses reused nonces.
    sqlx::query("insert into deposits (address, body, gross) values ($1,$2,$3) on conflict (address) do update set body = excluded.body, gross = excluded.gross, status = 'waiting', attempts = 0, retry_at = 0, error = null, tx = null")
        .bind(&addr)
        .bind(&body)
        .bind(it.gross.to_string())
        .execute(&s.db)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(json!({"id": addr, "address": it.owner, "status": "waiting"})))
}

async fn deposit_status(State(s): S, Path(addr): Path<String>) -> ApiResult<Json<Value>> {
    let a = addr.to_lowercase();
    let r = sqlx::query("select status, tx, error, gross from deposits where address = $1").bind(&a).fetch_optional(&s.db).await.map_err(|e| ApiError::Internal(e.into()))?;
    let r = r.ok_or(ApiError::NotFound)?;
    let bal = s.chain.usdc_balance(a.parse().map_err(|_| ApiError::BadRequest("address".into()))?).await.unwrap_or_default();
    Ok(Json(json!({"status": r.get::<String,_>("status"), "tx": r.get::<Option<String>,_>("tx"), "error": r.get::<Option<String>,_>("error"), "gross": r.get::<String,_>("gross"), "balance": bal.to_string()})))
}

async fn batches(State(s): S) -> ApiResult<Json<Value>> {
    let rows = sqlx::query("select batch, withdrawals, failed, txs from batches where withdrawals > 0 or failed > 0 order by batch desc limit 20").fetch_all(&s.db).await.map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(json!({"batches": rows.iter().map(|r| json!({"batch": r.get::<i64,_>("batch"), "withdrawals": r.get::<i32,_>("withdrawals"), "failed": r.get::<i32,_>("failed"), "txs": r.get::<Vec<String>,_>("txs")})).collect::<Vec<_>>()})))
}

/// Local/testnet only (FAUCET=1 and a MockUSDC deployment): mints up to 10,000 USDC.
async fn faucet(State(s): S, Json(body): Json<Value>) -> ApiResult<Json<Value>> {
    if !s.cfg.faucet {
        return Err(ApiError::NotFound);
    }
    let to = parse::address(&body, "address")?;
    let amount = parse::u256(&body, "amount")?;
    if amount > U256::from(10_000_000_000u64) {
        return Err(ApiError::BadRequest("faucet limit is 10,000 USDC".into()));
    }
    let r = s.chain.faucet(to, amount).await?;
    Ok(Json(serde_json::to_value(r).unwrap()))
}
