-- 005: fingerprints of the backup file keys (TSK-38, package 5).
-- Like encryption_keys, but for BACKUP_ENCRYPTION_SECRET_KEY (lib/keys.ts).
-- A table of its own because code from before package 5 refuses to start when
-- encryption_keys holds a key it hasn't loaded. Never the keys themselves;
-- written only by azure/register-keys.mjs; not part of backups/restores.
-- Apply BEFORE deploying package 5, then run node azure/register-keys.mjs.
-- Works with the older code too. Safe to run twice.
-- Apply with:  node azure/run-sql.mjs azure/migrations/005_backup_encryption_keys.sql
begin;

create table if not exists public.backup_encryption_keys (
  key_id      text primary key,
  fingerprint text not null,
  created_at  timestamp with time zone not null default now()
);

commit;
