//! Simulate-then-submit for every pool / router call. Sends are serialized per chain so nonces
//! never collide.
use crate::error::{ApiError, ApiResult};
use alloy::{
    network::EthereumWallet,
    primitives::{Address, Bytes, TxHash},
    providers::{DynProvider, Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
};
use tokio::sync::Mutex;
use vatanta_common::{
    contracts::{revert_name, DepositRouter, DestinationRegistry, MockUSDC, ShieldedPool, ERC20},
    deployment::Deployment,
};

pub struct Chain {
    pub address: Address,
    pub l1: DynProvider,
    pub c: DynProvider,
    pub dep: Deployment,
    l1_lock: Mutex<()>,
    c_lock: Mutex<()>,
    dest_cache: Mutex<Option<(std::time::Instant, Vec<serde_json::Value>)>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Submitted {
    pub tx_hash: TxHash,
    pub status: bool,
    pub gas_used: u64,
    pub block: u64,
}

fn rejected(e: alloy::contract::Error) -> ApiError {
    if let Some(data) = e.as_revert_data() {
        return ApiError::Rejected(revert_name(&data).unwrap_or_else(|| format!("0x{}", hex::encode(&data))));
    }
    // The node answered with an error (revert without data, nonce, funds…) → rejected.
    // No answer at all (connection refused, timeout) → upstream, worth retrying.
    if let alloy::contract::Error::TransportError(t) = &e {
        if !t.is_error_resp() {
            return ApiError::Upstream(e.to_string());
        }
    }
    ApiError::Rejected(e.to_string())
}

/// Waiting for the receipt failed: the tx may or may not be mined, so callers must re-check state.
fn receipt_err(e: impl std::fmt::Display) -> ApiError {
    ApiError::Upstream(format!("waiting for receipt: {e}"))
}

impl Chain {
    pub fn new(dep: Deployment, pk: &str) -> anyhow::Result<Self> {
        let signer: PrivateKeySigner = pk.parse()?;
        let address = signer.address();
        let wallet = EthereumWallet::from(signer);
        let l1 = ProviderBuilder::new().wallet(wallet.clone()).connect_http(dep.l1_rpc.parse()?).erased();
        let c = ProviderBuilder::new().wallet(wallet).connect_http(dep.c_rpc.parse()?).erased();
        Ok(Chain { address, l1, c, dep, l1_lock: Mutex::new(()), c_lock: Mutex::new(()), dest_cache: Mutex::new(None) })
    }

    /// L1 withdraw destinations from the C-Chain DestinationRegistry (SPEC §14); empty when the
    /// deployment has no registry.
    pub async fn destinations(&self) -> ApiResult<Vec<serde_json::Value>> {
        let Some(addr) = self.dep.destination_registry else { return Ok(vec![]) };
        let mut cache = self.dest_cache.lock().await;
        if let Some((at, v)) = cache.as_ref() {
            if at.elapsed() < std::time::Duration::from_secs(60) {
                return Ok(v.clone());
            }
        }
        let list = DestinationRegistry::new(addr, self.c.clone()).all().call().await.map_err(|e| ApiError::Upstream(e.to_string()))?;
        let v: Vec<serde_json::Value> = list
            .into_iter()
            .map(|d| {
                serde_json::json!({
                    "blockchainId": d.blockchainId,
                    "tokenRemote": d.tokenRemote,
                    "evmChainId": d.evmChainId.to::<u64>(),
                    "name": d.name,
                })
            })
            .collect();
        *cache = Some((std::time::Instant::now(), v.clone()));
        Ok(v)
    }

    fn pool(&self) -> ShieldedPool::ShieldedPoolInstance<DynProvider> {
        ShieldedPool::new(self.dep.shielded_pool, self.l1.clone())
    }

    fn router(&self) -> DepositRouter::DepositRouterInstance<DynProvider> {
        DepositRouter::new(self.dep.deposit_router, self.c.clone())
    }

    /// eth_call against the latest state: runs the on-chain UltraHonk verifier, root window,
    /// nullifier and fee checks without spending gas.
    pub async fn simulate_transfer(&self, proof: &Bytes, a: &ShieldedPool::TransferArgs) -> ApiResult<()> {
        self.pool().transfer(proof.clone(), a.clone()).call().await.map_err(rejected)?;
        Ok(())
    }
    pub async fn simulate_split(&self, proof: &Bytes, a: &ShieldedPool::SplitArgs) -> ApiResult<()> {
        self.pool().split(proof.clone(), a.clone()).call().await.map_err(rejected)?;
        Ok(())
    }
    pub async fn simulate_withdraw(&self, proof: &Bytes, a: &ShieldedPool::WithdrawArgs) -> ApiResult<()> {
        self.pool().withdraw(proof.clone(), a.clone()).call().await.map_err(rejected)?;
        Ok(())
    }

    pub async fn transfer(&self, proof: Bytes, a: ShieldedPool::TransferArgs) -> ApiResult<Submitted> {
        let _g = self.l1_lock.lock().await;
        let r = self.pool().transfer(proof, a).gas(7_000_000).send().await.map_err(rejected)?.get_receipt().await.map_err(receipt_err)?;
        Ok(Submitted { tx_hash: r.transaction_hash, status: r.status(), gas_used: r.gas_used, block: r.block_number.unwrap_or_default() })
    }
    pub async fn split(&self, proof: Bytes, a: ShieldedPool::SplitArgs) -> ApiResult<Submitted> {
        let _g = self.l1_lock.lock().await;
        let r = self.pool().split(proof, a).gas(10_000_000).send().await.map_err(rejected)?.get_receipt().await.map_err(receipt_err)?;
        Ok(Submitted { tx_hash: r.transaction_hash, status: r.status(), gas_used: r.gas_used, block: r.block_number.unwrap_or_default() })
    }
    pub async fn withdraw(&self, proof: Bytes, a: ShieldedPool::WithdrawArgs) -> ApiResult<Submitted> {
        let _g = self.l1_lock.lock().await;
        let r = self.pool().withdraw(proof, a).gas(6_000_000).send().await.map_err(rejected)?.get_receipt().await.map_err(receipt_err)?;
        Ok(Submitted { tx_hash: r.transaction_hash, status: r.status(), gas_used: r.gas_used, block: r.block_number.unwrap_or_default() })
    }

    /// On-chain truth used before retrying a withdrawal whose earlier attempt may have landed.
    pub async fn nullifier_spent(&self, n: alloy::primitives::U256) -> anyhow::Result<bool> {
        Ok(self.pool().nullifierSpent(n).call().await?)
    }

    /// On-chain truth used before retrying a deposit whose earlier attempt may have landed.
    pub async fn deposit_nonce_used(&self, owner: Address, nonce: alloy::primitives::U256) -> anyhow::Result<bool> {
        Ok(self.router().nonceUsed(owner, nonce).call().await?)
    }

    pub async fn usdc_balance(&self, who: Address) -> anyhow::Result<alloy::primitives::U256> {
        Ok(ERC20::new(self.dep.usdc, self.c.clone()).balanceOf(who).call().await?)
    }

    pub async fn deposit(&self, it: DepositRouter::DepositIntent, ps: DepositRouter::Sig, is: DepositRouter::Sig) -> ApiResult<Submitted> {
        let _g = self.c_lock.lock().await;
        let router = self.router();
        let call = router.deposit(it, ps, is);
        call.call().await.map_err(rejected)?;
        let r = call.send().await.map_err(rejected)?.get_receipt().await.map_err(receipt_err)?;
        Ok(Submitted { tx_hash: r.transaction_hash, status: r.status(), gas_used: r.gas_used, block: r.block_number.unwrap_or_default() })
    }

    /// Testnet faucet (MockUSDC only): stands in for "withdraw from an exchange".
    pub async fn faucet(&self, to: Address, amount: alloy::primitives::U256) -> ApiResult<Submitted> {
        let _g = self.c_lock.lock().await;
        let r = MockUSDC::new(self.dep.usdc, self.c.clone()).mint(to, amount).send().await.map_err(rejected)?.get_receipt().await.map_err(receipt_err)?;
        Ok(Submitted { tx_hash: r.transaction_hash, status: r.status(), gas_used: r.gas_used, block: r.block_number.unwrap_or_default() })
    }

    pub async fn l1_time(&self) -> u64 {
        match self.l1.get_block_by_number(alloy::eips::BlockNumberOrTag::Latest).await {
            Ok(Some(b)) => b.header.timestamp,
            _ => std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs(),
        }
    }
}
