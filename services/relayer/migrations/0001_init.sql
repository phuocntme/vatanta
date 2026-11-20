-- Vatanta relayer state: scheduled withdrawal pieces, watched deposit addresses, batch log.
create table if not exists scheduled (
  id bigserial primary key,
  batch bigint not null,              -- unix time of the 10-minute boundary chosen by the client
  nullifier text not null unique,
  proof text not null,
  args jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  tx text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists scheduled_due on scheduled (status, batch);

create table if not exists deposits (
  address text primary key,
  body jsonb not null,
  gross text not null,
  status text not null default 'waiting' check (status in ('waiting', 'done', 'failed', 'expired')),
  tx text,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists batches (
  batch bigint primary key,
  ran_at timestamptz not null default now(),
  withdrawals int not null,
  failed int not null,
  txs text[] not null default '{}'
);

create table if not exists submissions (
  tx text primary key,
  kind text not null,
  created_at timestamptz not null default now()
);
