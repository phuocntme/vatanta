use crate::AppState;
use alloy::{
    primitives::{Address, U256},
    providers::{Provider, ProviderBuilder},
    rpc::types::{Filter, Log},
    sol_types::SolEvent,
};
use std::{collections::HashMap, sync::Arc, time::Duration};
use vatanta_common::contracts::{DepositRouter, ShieldedPool};

const CHUNK: u64 = 2_000;

/// eth_getLogs span on C-Chain: the public Fuji / mainnet API refuses more than 100 blocks
/// (C_LOG_CHUNK overrides it for an RPC without that cap).
fn c_chunk() -> u64 {
    std::env::var("C_LOG_CHUNK").ok().and_then(|v| v.parse().ok()).filter(|n| *n > 0).unwrap_or(100)
}

pub async fn reset(db: &sqlx::PgPool) -> anyhow::Result<()> {
    sqlx::query("truncate cursors, leaves, nullifiers, withdrawals, private_txs, c_pieces").execute(db).await?;
    Ok(())
}

pub async fn load_tree(state: &Arc<AppState>) -> anyhow::Result<()> {
    let rows: Vec<(i64, String)> = sqlx::query_as("select leaf_index, commitment from leaves order by leaf_index").fetch_all(&state.db).await?;
    let leaves: Vec<U256> = rows.iter().map(|(_, c)| c.parse().unwrap()).collect();
    let mut t = state.tree.write().await;
    t.insert_many(&leaves);
    tracing::info!(leaves = leaves.len(), root = %t.root(), "tree loaded");
    Ok(())
}

async fn cursor(db: &sqlx::PgPool, chain: &str, default: u64) -> anyhow::Result<u64> {
    let r: Option<(i64,)> = sqlx::query_as("select next_block from cursors where chain = $1").bind(chain).fetch_optional(db).await?;
    Ok(r.map(|x| x.0 as u64).unwrap_or(default))
}

pub async fn run(state: Arc<AppState>) {
    let poll = Duration::from_millis(std::env::var("POLL_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(1_000));
    loop {
        if let Err(e) = tick_l1(&state).await {
            tracing::warn!("l1 indexing error: {e:#}");
        }
        if let Err(e) = tick_c(&state).await {
            tracing::warn!("c-chain indexing error: {e:#}");
        }
        tokio::time::sleep(poll).await;
    }
}

async fn block_times(p: &impl Provider, logs: &[Log]) -> anyhow::Result<HashMap<u64, u64>> {
    let mut out = HashMap::new();
    for l in logs {
        let b = l.block_number.unwrap_or_default();
        if let std::collections::hash_map::Entry::Vacant(e) = out.entry(b) {
            let t = match l.block_timestamp {
                Some(t) => t,
                None => p.get_block_by_number(b.into()).await?.map(|x| x.header.timestamp).unwrap_or_default(),
            };
            e.insert(t);
        }
    }
    Ok(out)
}

async fn tick_l1(state: &Arc<AppState>) -> anyhow::Result<()> {
    let p = ProviderBuilder::new().connect_http(state.dep.l1_rpc.parse()?);
    let head = p.get_block_number().await?;
    *state.l1_head.write().await = head;
    let mut from = cursor(&state.db, "l1", state.dep.l1_start_block.saturating_sub(100)).await?;
    while from <= head {
        let to = (from + CHUNK - 1).min(head);
        let logs = p.get_logs(&Filter::new().address(state.dep.shielded_pool).from_block(from).to_block(to)).await?;
        let times = block_times(&p, &logs).await?;
        let mut tx = state.db.begin().await?;
        let mut new_leaves: Vec<(u64, U256)> = Vec::new();
        for l in &logs {
            let block = l.block_number.unwrap_or_default() as i64;
            let time = *times.get(&(block as u64)).unwrap_or(&0) as i64;
            let txh = format!("{:#x}", l.transaction_hash.unwrap_or_default());
            let li = l.log_index.unwrap_or_default() as i32;
            let Some(t0) = l.topic0() else { continue };
            match *t0 {
                ShieldedPool::Deposit::SIGNATURE_HASH => {
                    let e = ShieldedPool::Deposit::decode_log(&l.inner)?.data;
                    sqlx::query("insert into leaves (leaf_index, commitment, kind, amount, denomination, precommit, block, time, tx, log_index) values ($1,$2,'deposit',$3,$4,$5,$6,$7,$8,$9) on conflict do nothing")
                        .bind(e.leafIndex as i64).bind(e.commitment.to_string()).bind(e.amount.to_string()).bind(e.denomination.to_string()).bind(e.precommit.to_string())
                        .bind(block).bind(time).bind(&txh).bind(li).execute(&mut *tx).await?;
                    new_leaves.push((e.leafIndex as u64, e.commitment));
                }
                ShieldedPool::NoteCommitted::SIGNATURE_HASH => {
                    let e = ShieldedPool::NoteCommitted::decode_log(&l.inner)?.data;
                    sqlx::query("insert into leaves (leaf_index, commitment, kind, view_tag, ciphertext, block, time, tx, log_index) values ($1,$2,'note',$3,$4,$5,$6,$7,$8) on conflict do nothing")
                        .bind(e.leafIndex as i64).bind(e.commitment.to_string()).bind(e.viewTag as i32).bind(format!("0x{}", hex::encode(&e.ciphertext)))
                        .bind(block).bind(time).bind(&txh).bind(li).execute(&mut *tx).await?;
                    new_leaves.push((e.leafIndex as u64, e.commitment));
                }
                ShieldedPool::NullifierSpent::SIGNATURE_HASH => {
                    let e = ShieldedPool::NullifierSpent::decode_log(&l.inner)?.data;
                    sqlx::query("insert into nullifiers (nullifier, block, time, tx, log_index) values ($1,$2,$3,$4,$5) on conflict do nothing")
                        .bind(e.nullifier.to_string()).bind(block).bind(time).bind(&txh).bind(li).execute(&mut *tx).await?;
                }
                ShieldedPool::Withdrawal::SIGNATURE_HASH => {
                    let e = ShieldedPool::Withdrawal::decode_log(&l.inner)?.data;
                    sqlx::query("insert into withdrawals (nullifier, denomination, recipient, relayer, fee, block, time, tx, log_index, destination, dest_transferrer) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing")
                        .bind(e.nullifier.to_string()).bind(e.denomination.to_string()).bind(format!("{:#x}", e.recipient)).bind(format!("{:#x}", e.relayer))
                        .bind(e.fee.to_string()).bind(block).bind(time).bind(&txh).bind(li)
                        .bind(format!("{:#x}", e.destination)).bind(format!("{:#x}", e.destTransferrer)).execute(&mut *tx).await?;
                }
                ShieldedPool::Transfer::SIGNATURE_HASH | ShieldedPool::Split::SIGNATURE_HASH => {
                    let kind = if *t0 == ShieldedPool::Transfer::SIGNATURE_HASH { "transfer" } else { "split" };
                    sqlx::query("insert into private_txs (tx, kind, block, time) values ($1,$2,$3,$4) on conflict do nothing")
                        .bind(&txh).bind(kind).bind(block).bind(time).execute(&mut *tx).await?;
                }
                _ => {}
            }
        }
        sqlx::query("insert into cursors (chain, next_block) values ('l1', $1) on conflict (chain) do update set next_block = excluded.next_block")
            .bind((to + 1) as i64).execute(&mut *tx).await?;
        tx.commit().await?;
        if !new_leaves.is_empty() {
            let mut t = state.tree.write().await;
            new_leaves.sort_by_key(|x| x.0);
            let fresh: Vec<U256> = new_leaves.into_iter().filter(|(i, _)| *i as usize >= t.len()).map(|x| x.1).collect();
            t.insert_many(&fresh);
            tracing::info!(leaves = t.len(), root = %t.root(), "tree updated");
        }
        from = to + 1;
    }
    Ok(())
}

async fn tick_c(state: &Arc<AppState>) -> anyhow::Result<()> {
    let p = ProviderBuilder::new().connect_http(state.dep.c_rpc.parse()?);
    let head = p.get_block_number().await?;
    let mut from = cursor(&state.db, "c", state.dep.c_start_block.saturating_sub(100)).await?;
    while from <= head {
        let to = (from + c_chunk() - 1).min(head);
        let logs = p
            .get_logs(&Filter::new().address(state.dep.deposit_router).event_signature(DepositRouter::PieceBridged::SIGNATURE_HASH).from_block(from).to_block(to))
            .await?;
        let mut tx = state.db.begin().await?;
        for l in &logs {
            let e = DepositRouter::PieceBridged::decode_log(&l.inner)?.data;
            sqlx::query("insert into c_pieces (tx, log_index, owner, denomination, net, block) values ($1,$2,$3,$4,$5,$6) on conflict do nothing")
                .bind(format!("{:#x}", l.transaction_hash.unwrap_or_default())).bind(l.log_index.unwrap_or_default() as i32)
                .bind(format!("{:#x}", e.owner)).bind(e.denomination.to_string()).bind(e.net.to_string()).bind(l.block_number.unwrap_or_default() as i64)
                .execute(&mut *tx).await?;
        }
        sqlx::query("insert into cursors (chain, next_block) values ('c', $1) on conflict (chain) do update set next_block = excluded.next_block")
            .bind((to + 1) as i64).execute(&mut *tx).await?;
        tx.commit().await?;
        from = to + 1;
    }
    Ok(())
}

#[allow(dead_code)]
pub fn addr(a: Address) -> String {
    format!("{a:#x}")
}
