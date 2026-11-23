-- 001: groundwork for field encryption (TSK-38, package 1).
-- Only adds things; existing code and data are unaffected. Safe to run twice.
-- Apply with:  node azure/run-sql.mjs azure/migrations/001_encryption.sql
begin;

-- Fingerprints of the encryption keys this database's data is encrypted with
-- (lib/keys.ts). Never the keys themselves. Written only by azure/register-keys.mjs.
-- Not part of backups/restores (lib/crm-tables.ts).
create table if not exists public.encryption_keys (
  key_id      text primary key,
  fingerprint text not null,
  created_at  timestamp with time zone not null default now()
);

-- Blind-index hashes for exact lookups once phone/email are encrypted
-- (HMAC-SHA256 hex, see blindIndex in lib/encryption.ts). Filled by
-- azure/encrypt-columns.mjs --hash-only and, from package 2, by the app.
alter table public.contacts             add column if not exists phone_hash text;
alter table public.contacts             add column if not exists email_hash text;
alter table public.whatsapp_messages    add column if not exists phone_hash text;
alter table public.broadcast_recipients add column if not exists phone_hash text;

-- Same shape as the plaintext indexes they will replace in package 2
-- (contacts_phone_idx, idx_contacts_email, whatsapp_messages_unmatched_phone_idx).
create index if not exists contacts_phone_hash_idx on public.contacts (phone_hash);
create index if not exists contacts_email_hash_idx on public.contacts (email_hash);
create index if not exists whatsapp_messages_unmatched_phone_hash_idx
  on public.whatsapp_messages (phone_hash) where (contact_id is null);
create index if not exists broadcast_recipients_phone_hash_idx on public.broadcast_recipients (phone_hash);

commit;
