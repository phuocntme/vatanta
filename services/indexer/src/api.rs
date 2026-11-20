use crate::AppState;
use alloy::{primitives::U256, providers::ProviderBuilder};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use vatanta_common::contracts::{ShieldedPool, ERC20};

type S = State<Arc<AppState>>;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/v1/events", get(events))
        .route("/v1/path/{leaf}", get(path))
        .route("/v1/root", get(root))
        .route("/v1/root/{root}", get(root_known))
        .route("/v1/stats", get(stats))
        .route("/v1/anonymity", get(anonymity))
        .route("/v1/batches", get(batches))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

struct ApiError(anyhow::Error);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": {"code": "internal", "message": self.0.to_string()}}))).into_response()
    }
}
impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(e: E) -> Self {
        ApiError(e.into())
    }
}
type R<T> = Result<T, ApiError>;

#[derive(Deserialize)]
struct From_ {
    from: Option<i64>,
}

/// Same shape as the SDK's `parseEvents` (bigints as decimal strings).
async fn events(State(s): S, Query(q): Query<From_>) -> R<Json<Value>> {
    let from = q.from.unwrap_or(0);
    let cursor: i64 = sqlx::query_scalar("select coalesce((select next_block from cursors where chain='l1'), 0)").fetch_one(&s.db).await?;
    let mut ev: Vec<(i64, i32, Value)> = Vec::new();
    for r in sqlx::query("select * from leaves where block >= $1 and block < $2").bind(from).bind(cursor).fetch_all(&s.db).await? {
        let kind: String = r.get("kind");
        let base = (r.get::<i64, _>("block"), r.get::<i32, _>("log_index"));
        let v = if kind == "deposit" {
            json!({"kind":"deposit","leafIndex":r.get::<i64,_>("leaf_index"),"commitment":r.get::<String,_>("commitment"),"amount":r.get::<Option<String>,_>("amount"),
                   "denomination":r.get::<Option<String>,_>("denomination"),"precommit":r.get::<Option<String>,_>("precommit"),
                   "block":base.0,"time":r.get::<i64,_>("time"),"tx":r.get::<String,_>("tx")})
        } else {
            json!({"kind":"note","leafIndex":r.get::<i64,_>("leaf_index"),"commitment":r.get::<String,_>("commitment"),"viewTag":r.get::<Option<i32>,_>("view_tag"),
                   "ciphertext":r.get::<Option<String>,_>("ciphertext"),"block":base.0,"time":r.get::<i64,_>("time"),"tx":r.get::<String,_>("tx")})
        };
        ev.push((base.0, base.1, v));
    }
    for r in sqlx::query("select * from nullifiers where block >= $1 and block < $2").bind(from).bind(cursor).fetch_all(&s.db).await? {
        ev.push((r.get("block"), r.get("log_index"), json!({"kind":"nullifier","nullifier":r.get::<String,_>("nullifier"),"block":r.get::<i64,_>("block"),"time":r.get::<i64,_>("time"),"tx":r.get::<String,_>("tx")})));
    }
    for r in sqlx::query("select * from withdrawals where block >= $1 and block < $2").bind(from).bind(cursor).fetch_all(&s.db).await? {
        ev.push((r.get("block"), r.get("log_index"), json!({"kind":"withdrawal","nullifier":r.get::<String,_>("nullifier"),"denomination":r.get::<String,_>("denomination"),
            "recipient":r.get::<String,_>("recipient"),"relayer":r.get::<String,_>("relayer"),"fee":r.get::<String,_>("fee"),"destination":r.get::<String,_>("destination"),"block":r.get::<i64,_>("block"),"time":r.get::<i64,_>("time"),"tx":r.get::<String,_>("tx")})));
    }
    ev.sort_by_key(|x| (x.0, x.1));
    Ok(Json(json!({"events": ev.into_iter().map(|x| x.2).collect::<Vec<_>>(), "cursor": cursor})))
}

async fn path(State(s): S, Path(leaf): Path<usize>) -> R<Response> {
    let t = s.tree.read().await;
    Ok(match t.path(leaf) {
        Some(p) => Json(json!({"leafIndex": leaf, "path": p.iter().map(|x| x.to_string()).collect::<Vec<_>>(), "root": t.root().to_string()})).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({"error":{"code":"unknown_leaf","message":"leaf not indexed yet"}}))).into_response(),
    })
}

async fn root(State(s): S) -> R<Json<Value>> {
    let t = s.tree.read().await;
    Ok(Json(json!({"root": t.root().to_string(), "nextIndex": t.len()})))
}

async fn root_known(State(s): S, Path(root): Path<String>) -> R<Json<Value>> {
    let r: U256 = root.parse()?;
    let p = ProviderBuilder::new().connect_http(s.dep.l1_rpc.parse()?);
    let known = ShieldedPool::new(s.dep.shielded_pool, &p).isKnownRoot(r).call().await?;
    Ok(Json(json!({"root": root, "known": known})))
}

const DENOMS: [u64; 4] = [10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000];

async fn crowd(db: &sqlx::PgPool, since: i64) -> anyhow::Result<Vec<Value>> {
    let mut out = Vec::new();
    for d in DENOMS {
        let ds = d.to_string();
        let deposits: i64 = sqlx::query_scalar("select count(*) from leaves where kind='deposit' and denomination=$1 and time >= $2").bind(&ds).bind(since).fetch_one(db).await?;
        let withdrawals: i64 = sqlx::query_scalar("select count(*) from withdrawals where denomination=$1 and time >= $2").bind(&ds).bind(since).fetch_one(db).await?;
        out.push(json!({"denomination": ds, "deposits": deposits, "withdrawals": withdrawals, "crowd": (deposits - withdrawals).max(0)}));
    }
    Ok(out)
}

#[derive(Deserialize)]
struct AnonQ {
    since: Option<i64>,
}

async fn anonymity(State(s): S, Query(q): Query<AnonQ>) -> R<Json<Value>> {
    Ok(Json(json!({"since": q.since.unwrap_or(0), "denominations": crowd(&s.db, q.since.unwrap_or(0)).await?})))
}

async fn batch_rows(db: &sqlx::PgPool, limit: i64) -> anyhow::Result<Vec<Value>> {
    let interval: i64 = std::env::var("BATCH_INTERVAL_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(600);
    let rows = sqlx::query(
        "with w as (select (time / $1) * $1 as b, count(*) as n, min(tx) as tx from withdrawals group by 1),
              p as (select (time / $1) * $1 as b, count(*) as n from private_txs group by 1)
         select coalesce(w.b, p.b) as b, coalesce(p.n, 0) as private_txs, coalesce(w.n, 0) as withdrawals, w.tx
         from w full outer join p on w.b = p.b order by 1 desc limit $2",
    )
    .bind(interval)
    .bind(limit)
    .fetch_all(db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| {
            let b: i64 = r.get("b");
            json!({"batch": b / interval, "time": b, "privateTxs": r.get::<i64,_>("private_txs"), "withdrawals": r.get::<i64,_>("withdrawals"), "tx": r.get::<Option<String>,_>("tx")})
        })
        .collect())
}

async fn batches(State(s): S) -> R<Json<Value>> {
    Ok(Json(json!({"batches": batch_rows(&s.db, 20).await?})))
}

/// Everything the public Verify page shows, built from on-chain data.
async fn stats(State(s): S) -> R<Json<Value>> {
    let c = ProviderBuilder::new().connect_http(s.dep.c_rpc.parse()?);
    let l1 = ProviderBuilder::new().connect_http(s.dep.l1_rpc.parse()?);
    let home_usdc = ERC20::new(s.dep.usdc, &c).balanceOf(s.dep.token_home).call().await.unwrap_or_default();
    let pool_usdc = ERC20::new(s.dep.token_remote, &l1).balanceOf(s.dep.shielded_pool).call().await.unwrap_or_default();
    let (root, notes) = {
        let t = s.tree.read().await;
        (t.root(), t.len())
    };
    let nullifiers: i64 = sqlx::query_scalar("select count(*) from nullifiers").fetch_one(&s.db).await?;
    let private_txs: i64 = sqlx::query_scalar("select count(*) from private_txs").fetch_one(&s.db).await?;
    let validators = validators(&s).await.unwrap_or(json!({"online": null, "total": null}));
    // SPEC §14: withdrawals per destination (0x00…0 = C-Chain) and denomination
    let by_dest: Vec<Value> = sqlx::query("select destination, denomination, count(*) as n from withdrawals group by 1, 2 order by 1, 2")
        .fetch_all(&s.db)
        .await?
        .into_iter()
        .map(|r| json!({"destination": r.get::<String,_>("destination"), "denomination": r.get::<String,_>("denomination"), "withdrawals": r.get::<i64,_>("n")}))
        .collect();
    Ok(Json(json!({
        "withdrawalsByDestination": by_dest,
        "bridgeUsdc": home_usdc.to_string(),
        "poolUsdc": pool_usdc.to_string(),
        "notes": notes,
        "nullifiers": nullifiers,
        "privateTxs": private_txs,
        "root": format!("{:#066x}", root),
        "crowd": crowd(&s.db, 0).await?,
        "batches": batch_rows(&s.db, 5).await?,
        "validators": validators,
        "l1Head": *s.l1_head.read().await,
        "contracts": {
            "shieldedPool": s.dep.shielded_pool, "tokenHome": s.dep.token_home, "tokenRemote": s.dep.token_remote,
            "depositRouter": s.dep.deposit_router, "verifierRegistry": s.dep.verifier_registry, "relayerRegistry": s.dep.relayer_registry,
            "usdc": s.dep.usdc,
        },
        "network": s.dep.network,
    })))
}

/// Subnet-EVM exposes `validators.getCurrentValidators` on /ext/bc/<id>/validators.
async fn validators(s: &AppState) -> anyhow::Result<Value> {
    let url = s.dep.l1_rpc.trim_end_matches("/rpc").to_string() + "/validators";
    let r: Value = s
        .http
        .post(url)
        .json(&json!({"jsonrpc":"2.0","id":1,"method":"validators.getCurrentValidators","params":{"nodeIDs":[]}}))
        .send()
        .await?
        .json()
        .await?;
    let list = r["result"]["validators"].as_array().cloned().unwrap_or_default();
    let online = list.iter().filter(|v| v["isConnected"].as_bool().unwrap_or(false) || v["isActive"].as_bool().unwrap_or(false)).count();
    Ok(json!({"online": online, "total": list.len()}))
}
