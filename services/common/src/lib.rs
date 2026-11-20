//! Shared code for the Vatanta relayer and indexer: Poseidon2 + Merkle tree (bit-compatible with
//! the circuits and contracts), contract bindings and deployment config.
pub mod contracts;
pub mod deployment;
pub mod merkle;
pub mod poseidon2;

pub use alloy::primitives::{Address, B256, U256};
