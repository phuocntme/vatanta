//! Vatanta relayer: accepts proofs over HTTP, verifies them (eth_call runs the on-chain verifier),
//! submits and pays gas; runs the 10-minute withdrawal batch tick; watches one-time deposit
//! addresses. Anyone can run one; users can also self-submit to the pool.
mod api;
mod chain;
mod deposits;
mod error;
mod parse;
mod scheduler;

use anyhow::Context;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use vatanta_common::deployment::Deployment;

pub struct Config {
    pub batch_interval: i64,
    pub deposit_poll_secs: u64,
    pub faucet: bool,
}

pub struct AppState {
    pub chain: chain::Chain,
    pub db: sqlx::PgPool,
    pub cfg: Config,
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
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "vatanta_relayer=info".into()))
        .init();
    let dep_path = std::env::var("DEPLOYMENT").unwrap_or_else(|_| "../contracts/deployments/local.json".into());
    let dep = Deployment::load(&dep_path).with_context(|| format!("loading {dep_path}"))?.with_env_overrides();
    let pk = std::env::var("RELAYER_PK").context("RELAYER_PK not set")?;
    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://localhost/vatanta_relayer".into());
    let db = PgPoolOptions::new().max_connections(8).connect(&db_url).await.context("connect postgres")?;
    sqlx::migrate!("./migrations").run(&db).await?;
    if std::env::var("RELAYER_RESET").as_deref() == Ok("1") {
        sqlx::query("truncate scheduled, deposits, batches, submissions").execute(&db).await?;
    }
    if reset_if_pool_changed(&db, dep.shielded_pool, "scheduled, deposits, batches, submissions").await? {
        tracing::warn!(pool = %dep.shielded_pool, "deployment has a new pool: queued withdrawals and deposits of the old one dropped");
    }
    let cfg = Config {
        // 600 s is the locked parameter; tests may shorten it (BATCH_INTERVAL_SECS) to run fast.
        batch_interval: std::env::var("BATCH_INTERVAL_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(600),
        deposit_poll_secs: std::env::var("DEPOSIT_POLL_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(3),
        faucet: std::env::var("FAUCET").as_deref() == Ok("1"),
    };
    let state = Arc::new(AppState { chain: chain::Chain::new(dep, &pk)?, db, cfg });
    tracing::info!(relayer = %state.chain.address, pool = %state.chain.dep.shielded_pool, interval = state.cfg.batch_interval, "relayer starting");
    tokio::spawn(scheduler::run(state.clone()));
    tokio::spawn(deposits::run(state.clone()));
    let bind = std::env::var("BIND").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "relayer listening");
    axum::serve(listener, api::router(state)).await?;
    Ok(())
}
