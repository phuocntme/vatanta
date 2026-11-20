//! Watches one-time deposit addresses on C-Chain; once the USDC arrives, calls DepositRouter
//! with the user's pre-signed permit + intent (the address never needs AVAX).
//!
//! Transient RPC errors are retried with backoff. Before a retry the router's `nonceUsed` is
//! checked, because an earlier attempt may have been mined even though its receipt never arrived.
use crate::{parse, scheduler::now, AppState};
use alloy::primitives::{Address, U256};
use serde_json::Value;
use sqlx::Row;
use std::{sync::Arc, time::Duration};

pub const MAX_ATTEMPTS: i32 = 8;

/// 5 s, 10 s, 20 s … capped at 5 min.
pub fn backoff_secs(attempts: i32) -> i64 {
    (5i64 << attempts.clamp(0, 6)).min(300)
}

pub async fn run(state: Arc<AppState>) {
    loop {
        if let Err(e) = tick(&state).await {
            tracing::warn!("deposit watcher: {e:#}");
        }
        tokio::time::sleep(Duration::from_secs(state.cfg.deposit_poll_secs)).await;
    }
}

async fn set_status(state: &AppState, address: &str, status: &str, tx: Option<String>, error: Option<String>) -> anyhow::Result<()> {
    sqlx::query("update deposits set status=$2, tx=coalesce($3, tx), error=$4 where address=$1")
        .bind(address)
        .bind(status)
        .bind(tx)
        .bind(error)
        .execute(&state.db)
        .await?;
    Ok(())
}

async fn tick(state: &Arc<AppState>) -> anyhow::Result<()> {
    let rows = sqlx::query("select address, body, gross, attempts from deposits where status = 'waiting' and retry_at <= $1")
        .bind(now())
        .fetch_all(&state.db)
        .await?;
    for r in rows {
        let address: String = r.get("address");
        if let Err(e) = handle(state, &address, r.get("body"), r.get("gross"), r.get("attempts")).await {
            // one bad row must not block the others
            tracing::warn!(%address, "deposit check: {e:#}");
        }
    }
    Ok(())
}

async fn handle(state: &Arc<AppState>, address: &str, body: Value, gross: String, attempts: i32) -> anyhow::Result<()> {
    let gross: U256 = gross.parse()?;
    let who: Address = address.parse()?;
    let (it, ps, is) = match parse::deposit(&body) {
        Ok(x) => x,
        Err(e) => return set_status(state, address, "failed", None, Some(e.to_string())).await,
    };
    if it.deadline < U256::from(now() as u64) {
        return set_status(state, address, "expired", None, None).await;
    }
    if attempts > 0 && state.chain.deposit_nonce_used(it.owner, it.nonce).await? {
        tracing::info!(%address, "deposit already landed on-chain (receipt was lost)");
        return set_status(state, address, "done", None, None).await;
    }
    if state.chain.usdc_balance(who).await? < gross {
        return Ok(());
    }
    tracing::info!(%address, %gross, attempts, "deposit funded, calling DepositRouter");
    match state.chain.deposit(it, ps, is).await {
        Ok(s) => {
            let status = if s.status { "done" } else { "failed" };
            set_status(state, address, status, Some(format!("{:#x}", s.tx_hash)), None).await
        }
        Err(e) if e.is_transient() && attempts + 1 < MAX_ATTEMPTS => {
            tracing::warn!(%address, attempts, "deposit attempt failed, will retry: {e}");
            sqlx::query("update deposits set attempts = attempts + 1, retry_at = $2, error = $3 where address = $1")
                .bind(address)
                .bind(now() + backoff_secs(attempts))
                .bind(e.to_string())
                .execute(&state.db)
                .await?;
            Ok(())
        }
        Err(e) => {
            tracing::warn!(%address, "deposit failed: {e}");
            set_status(state, address, "failed", None, Some(e.to_string())).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff_secs(0), 5);
        assert_eq!(backoff_secs(1), 10);
        assert_eq!(backoff_secs(3), 40);
        assert_eq!(backoff_secs(6), 300);
        assert_eq!(backoff_secs(50), 300);
        assert_eq!(backoff_secs(-1), 5);
    }
}
