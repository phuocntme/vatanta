//! The 10-minute batch tick. Pieces are stored with the batch the CLIENT picked; the relayer only
//! submits each piece when its batch comes due.
use crate::{deposits::MAX_ATTEMPTS, parse, AppState};
use serde_json::Value;
use sqlx::Row;
use std::{sync::Arc, time::Duration};

pub fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64
}

pub fn next_batch(now: i64, interval: i64) -> i64 {
    (now / interval + 1) * interval
}

pub async fn run(state: Arc<AppState>) {
    let interval = state.cfg.batch_interval;
    loop {
        let wait = next_batch(now(), interval) - now();
        tokio::time::sleep(Duration::from_secs(wait.max(1) as u64)).await;
        let batch = (now() / interval) * interval;
        if let Err(e) = run_batch(&state, batch).await {
            tracing::warn!("batch {batch} failed: {e:#}");
        }
    }
}

pub async fn run_batch(state: &Arc<AppState>, batch: i64) -> anyhow::Result<()> {
    let rows = sqlx::query("select id, proof, args, attempts from scheduled where status = 'queued' and batch <= $1 order by batch, id")
        .bind(batch)
        .fetch_all(&state.db)
        .await?;
    let (mut ok, mut failed, mut txs) = (0, 0, Vec::<String>::new());
    for r in rows {
        let id: i64 = r.get("id");
        let attempts: i32 = r.get("attempts");
        match submit(state, r.get("proof"), r.get("args"), attempts).await {
            Outcome::Sent(h) => {
                ok += 1;
                sqlx::query("update scheduled set status='sent', tx=$2, error=null where id=$1").bind(id).bind(&h).execute(&state.db).await?;
                if let Some(h) = h {
                    txs.push(h);
                }
            }
            Outcome::Retry(e) => {
                // stays queued; picked up again by the next batch tick
                tracing::warn!(id, attempts, "withdrawal attempt failed, retrying next batch: {e}");
                sqlx::query("update scheduled set attempts = attempts + 1, error=$2 where id=$1").bind(id).bind(e).execute(&state.db).await?;
            }
            Outcome::Failed(e, tx) => {
                failed += 1;
                sqlx::query("update scheduled set status='failed', error=$2, tx=$3 where id=$1").bind(id).bind(e).bind(tx).execute(&state.db).await?;
            }
        }
    }
    if ok + failed > 0 {
        tracing::info!(batch, ok, failed, "batch submitted");
    }
    sqlx::query("insert into batches (batch, withdrawals, failed, txs) values ($1,$2,$3,$4) on conflict (batch) do update set withdrawals = batches.withdrawals + excluded.withdrawals, failed = batches.failed + excluded.failed, txs = batches.txs || excluded.txs")
        .bind(batch)
        .bind(ok)
        .bind(failed)
        .bind(&txs)
        .execute(&state.db)
        .await?;
    Ok(())
}

enum Outcome {
    /// tx hash, or None when a lost earlier attempt is found already spent on-chain
    Sent(Option<String>),
    Retry(String),
    Failed(String, Option<String>),
}

async fn submit(state: &Arc<AppState>, proof: String, args: Value, attempts: i32) -> Outcome {
    let parsed = parse::bytes(&proof, "proof").and_then(|p| Ok((p, parse::withdraw_args(&args)?)));
    let (p, a) = match parsed {
        Ok(x) => x,
        Err(e) => return Outcome::Failed(e.to_string(), None),
    };
    if attempts > 0 {
        // an earlier attempt may have been mined even though we never saw its receipt
        match state.chain.nullifier_spent(a.nullifier).await {
            Ok(true) => return Outcome::Sent(None),
            Ok(false) => {}
            Err(e) if attempts + 1 < MAX_ATTEMPTS => return Outcome::Retry(e.to_string()),
            Err(e) => return Outcome::Failed(e.to_string(), None),
        }
    }
    match state.chain.withdraw(p, a).await {
        Ok(s) if s.status => Outcome::Sent(Some(format!("{:#x}", s.tx_hash))),
        Ok(s) => Outcome::Failed("reverted".into(), Some(format!("{:#x}", s.tx_hash))),
        Err(e) if e.is_transient() && attempts + 1 < MAX_ATTEMPTS => Outcome::Retry(e.to_string()),
        Err(e) => Outcome::Failed(e.to_string(), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_batch_is_the_following_boundary() {
        assert_eq!(next_batch(0, 600), 600);
        assert_eq!(next_batch(599, 600), 600);
        assert_eq!(next_batch(600, 600), 1200);
        assert_eq!(next_batch(1_700_000_123, 600), 1_700_000_400);
    }
}
