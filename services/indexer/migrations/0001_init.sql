-- Vatanta indexer schema. All uint256 values are stored as decimal text; hashes/addresses as 0x hex.
create table if not exists cursors (
  chain text primary key,
  next_block bigint not null
);

create table if not exists leaves (
  leaf_index bigint primary key,
  commitment text not null,
  kind text not null check (kind in ('deposit', 'note')),
  amount text,          -- deposit only (net micro-USDC)
  denomination text,    -- deposit only (gross)
  precommit text,       -- deposit only
  view_tag int,         -- note only
  ciphertext text,      -- note only, 0x hex
  block bigint not null,
  time bigint not null,
  tx text not null,
  log_index int not null
);
create index if not exists leaves_block on leaves (block);
create index if not exists leaves_denom_time on leaves (denomination, time);

create table if not exists nullifiers (
  nullifier text primary key,
  block bigint not null,
  time bigint not null,
  tx text not null,
  log_index int not null
);
create index if not exists nullifiers_block on nullifiers (block);

create table if not exists withdrawals (
  nullifier text primary key,
  denomination text not null,
  recipient text not null,
  relayer text not null,
  fee text not null,
  block bigint not null,
  time bigint not null,
  tx text not null,
  log_index int not null
);
create index if not exists withdrawals_denom_time on withdrawals (denomination, time);

-- transfer / split transactions (only that they happened; contents are private)
create table if not exists private_txs (
  tx text primary key,
  kind text not null,
  block bigint not null,
  time bigint not null
);

-- C-Chain side: pieces bridged by the DepositRouter (public anyway)
create table if not exists c_pieces (
  tx text not null,
  log_index int not null,
  owner text not null,
  denomination text not null,
  net text not null,
  block bigint not null,
  primary key (tx, log_index)
);
