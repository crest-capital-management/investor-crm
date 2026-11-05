-- Phase 2: the CRM's own login table (replaces Supabase Auth).
--
-- One row per person who can sign in. The CRM has a single owner: their row
-- keeps the same id as their old Supabase user (CRM_OWNER_ID), so the owner
-- check in lib/auth.ts and proxy.ts works unchanged. Passwords are stored only
-- as bcrypt hashes; set one with `node azure/set-password.js`.
--
-- Run once on crest_crm after schema.sql.

begin;

create table public.crm_users (
  id uuid not null default gen_random_uuid(),
  email text not null,
  name text,
  password_hash text not null,
  created_at timestamp with time zone not null default now(),
  password_updated_at timestamp with time zone not null default now(),
  last_login_at timestamp with time zone,
  constraint crm_users_pkey primary key (id),
  constraint crm_users_email_lower check (email = lower(email)),
  constraint crm_users_password_hash_bcrypt check (password_hash like '$2%')
);

create unique index crm_users_email_unique on public.crm_users (email);

commit;
