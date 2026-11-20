-- Retries for transient RPC failures (timeouts, node restarts). A piece or deposit is only marked
-- 'failed' when the chain rejects it or after MAX_ATTEMPTS transient errors.
alter table scheduled add column if not exists attempts int not null default 0;
alter table deposits add column if not exists attempts int not null default 0;
alter table deposits add column if not exists retry_at bigint not null default 0; -- unix seconds
