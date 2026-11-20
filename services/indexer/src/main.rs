//! Vatanta indexer: follows ShieldedPool (L1) and DepositRouter (C-Chain) logs into Postgres,
//! keeps the Merkle tree in memory and serves the SDK / Verify page over HTTP.
mod api;
mod worker;

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tokio::sync::RwLock;
use vatanta_common::{deployment::Deployment, merkle::Tree};

pub struct AppState {
    pub db: sqlx::PgPool,
    pub dep: Deployment,
    pub tree: RwLock<Tree>,
    pub l1_head: RwLock<u64>,
    pub http: reqwest::Client,
}

/// Wipes `tables` when the database was filled for another pool than the deployment's (after a
/// redeploy) or before the marker existed, then records the pool. Returns true when it wiped.
async fn reset_if_pool_changed(db: &sqlx::PgPool, pool: alloy::primitives::Address, tables: &str) -> anyhow::Result<bool> {
    let now = format!("{pool:#x}");
    let prev: Option<String> = sqlx::query_scalar("select value from meta where key = 'pool'").fetch_optional(db).await?;
    // no marker = data written before markers existed, i.e. for an older pool
    let wipe = prev.as_deref() != Some(now.as_str());
    if wipe {
        sqlx::query(&format!("truncate {tables}")).execute(db).await?;
    }
    sqlx::query("insert into meta (key, value) values ('pool', $1) on conflict (key) do update set value = excluded.value").bind(&now).execute(db).await?;
    Ok(wipe)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "vatanta_indexer=info".into()))
        .init();
    let dep_path = std::env::var("DEPLOYMENT").unwrap_or_else(|_| "../contracts/deployments/local.json".into());
    let dep = Deployment::load(&dep_path).with_context(|| format!("loading {dep_path}"))?.with_env_overrides();
    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost/vatanta_indexer".into());
    let db = PgPoolOptions::new().max_connections(8).connect(&db_url).await.context("connect postgres")?;
    sqlx::migrate!("./migrations").run(&db).await?;
    if std::env::var("INDEXER_RESET").as_deref() == Ok("1") {
        worker::reset(&db).await?;
    }
    if reset_if_pool_changed(&db, dep.shielded_pool, "cursors, leaves, nullifiers, withdrawals, private_txs, c_pieces").await? {
        tracing::warn!(pool = %dep.shielded_pool, "deployment has a new pool: indexed data wiped");
    }
    let state = Arc::new(AppState {
        db,
        dep,
        tree: RwLock::new(Tree::new()),
        l1_head: RwLock::new(0),
        http: reqwest::Client::new(),
    });
    worker::load_tree(&state).await?;
    tokio::spawn(worker::run(state.clone()));
    let bind = std::env::var("BIND").unwrap_or_else(|_| "0.0.0.0:8081".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, pool = %state.dep.shielded_pool, "indexer listening");
    axum::serve(listener, api::router(state)).await?;
    Ok(())
}
