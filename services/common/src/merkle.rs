//! Depth-32 incremental Merkle tree, identical to `ShieldedPool`/`MerkleTree.sol` and the SDK.
use crate::poseidon2::hash2;
use alloy::primitives::U256;

pub const DEPTH: usize = 32;

pub fn zeros() -> Vec<U256> {
    let mut z = vec![U256::ZERO];
    for i in 1..=DEPTH {
        z.push(hash2(z[i - 1], z[i - 1]));
    }
    z
}

#[derive(Clone)]
pub struct Tree {
    layers: Vec<Vec<U256>>,
    zeros: Vec<U256>,
}

impl Default for Tree {
    fn default() -> Self {
        Self::new()
    }
}

impl Tree {
    pub fn new() -> Self {
        Tree { layers: vec![Vec::new(); DEPTH + 1], zeros: zeros() }
    }

    pub fn len(&self) -> usize {
        self.layers[0].len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn root(&self) -> U256 {
        self.layers[DEPTH].first().copied().unwrap_or(self.zeros[DEPTH])
    }

    pub fn insert_many(&mut self, leaves: &[U256]) -> usize {
        let start = self.len();
        if leaves.is_empty() {
            return start;
        }
        self.layers[0].extend_from_slice(leaves);
        let (mut lo, mut hi) = (start, self.len() - 1);
        for d in 0..DEPTH {
            for p in (lo >> 1)..=(hi >> 1) {
                let l = self.layers[d][2 * p];
                let r = self.layers[d].get(2 * p + 1).copied().unwrap_or(self.zeros[d]);
                let h = hash2(l, r);
                if p < self.layers[d + 1].len() {
                    self.layers[d + 1][p] = h;
                } else {
                    self.layers[d + 1].push(h);
                }
            }
            lo >>= 1;
            hi >>= 1;
        }
        start
    }

    pub fn path(&self, index: usize) -> Option<Vec<U256>> {
        if index >= self.len() {
            return None;
        }
        let mut i = index;
        let mut out = Vec::with_capacity(DEPTH);
        for d in 0..DEPTH {
            out.push(self.layers[d].get(i ^ 1).copied().unwrap_or(self.zeros[d]));
            i >>= 1;
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn single_leaf_root_and_paths() {
        let mut t = Tree::new();
        t.insert_many(&[U256::from(5)]);
        let z = zeros();
        let mut n = U256::from(5);
        for d in 0..DEPTH {
            n = hash2(n, z[d]);
        }
        assert_eq!(t.root(), n);
        let leaves: Vec<U256> = (0..13u64).map(|i| U256::from(i * 3 + 1)).collect();
        let mut a = Tree::new();
        a.insert_many(&leaves[..4]);
        a.insert_many(&leaves[4..]);
        let mut b = Tree::new();
        b.insert_many(&leaves);
        assert_eq!(a.root(), b.root());
        for (i, l) in leaves.iter().enumerate() {
            let p = b.path(i).unwrap();
            let mut node = *l;
            for d in 0..DEPTH {
                node = if (i >> d) & 1 == 1 { hash2(p[d], node) } else { hash2(node, p[d]) };
            }
            assert_eq!(node, b.root());
        }
    }
}
