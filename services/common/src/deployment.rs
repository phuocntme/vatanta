use alloy::primitives::{Address, B256};
use serde::Deserialize;

/// contracts/deployments/<network>.json written by contracts/script/deploy.sh
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deployment {
    pub network: String,
    pub c_chain_id: u64,
    pub l1_chain_id: u64,
    pub c_rpc: String,
    pub l1_rpc: String,
    pub c_blockchain_id: B256,
    pub l1_blockchain_id: B256,
    pub usdc: Address,
    pub token_home: Address,
    pub token_remote: Address,
    pub deposit_router: Address,
    pub shielded_pool: Address,
    pub verifier_registry: Address,
    pub relayer_registry: Address,
    /// C-Chain DestinationRegistry (SPEC §14); absent in deployments made before it existed
    #[serde(default)]
    pub destination_registry: Option<Address>,
    pub l1_start_block: u64,
    pub c_start_block: u64,
}

impl Deployment {
    pub fn load(path: &str) -> anyhow::Result<Self> {
        Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
    }

    /// RPC URLs can be overridden (e.g. inside Docker, where 127.0.0.1 is not the host).
    pub fn with_env_overrides(mut self) -> Self {
        match std::env::var("L1_RPC") {
            Ok(v) if !v.is_empty() => self.l1_rpc = v,
            _ => {}
        }
        match std::env::var("C_RPC") {
            Ok(v) if !v.is_empty() => self.c_rpc = v,
            _ => {}
        }
        self
    }
}
