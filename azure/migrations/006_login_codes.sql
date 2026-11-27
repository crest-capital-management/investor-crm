-- 006: one-time sign-in codes sent by email (TSK-38, package 7b).
-- After the password, the CRM emails a 6-digit code; this table holds the
-- pending ones. Only keyed fingerprints are stored (never the code itself, and
-- never the browser's token); rows are used once, expire after 10 minutes and
-- are cleaned up after a day (lib/login-codes.ts). Not part of backups.
-- Apply BEFORE deploying package 7b (sign-in needs it). Works with the older
-- code too. Safe to run twice.
-- Apply with:  node azure/run-sql.mjs azure/migrations/006_login_codes.sql
begin;

create table if not exists public.login_codes (
  token_hash  text primary key,
  user_id     uuid not null references public.crm_users (id) on delete cascade,
  code_hash   text not null,
  attempts    integer not null default 0,
  expires_at  timestamp with time zone not null,
  used_at     timestamp with time zone,
  created_at  timestamp with time zone not null default now()
);
create index if not exists login_codes_user_created_idx on public.login_codes (user_id, created_at);

commit;
