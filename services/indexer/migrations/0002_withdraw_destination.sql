-- SPEC §14: withdrawals can land on another L1. destination = its blockchain id (0x00…0 = C-Chain).
alter table withdrawals add column if not exists destination text not null
  default '0x0000000000000000000000000000000000000000000000000000000000000000';
alter table withdrawals add column if not exists dest_transferrer text not null
  default '0x0000000000000000000000000000000000000000';
