// Turns schema.json (live Supabase read) into azure/schema.sql without the Supabase-only parts.
const fs = require('fs');
const path = require('path');
const s = require(path.join(__dirname, 'schema.json'));

const order = ['contacts', 'groups', 'templates', 'broadcasts', 'broadcast_recipients', 'contact_groups',
  'follow_ups', 'interactions', 'portfolio_updates', 'whatsapp_messages', 'app_settings'];
const live = s.tables.filter(t => t.relkind === 'r').map(t => t.relname).sort();
if (JSON.stringify([...order].sort()) !== JSON.stringify(live)) throw new Error('table list changed: ' + live.join(','));

const skipFunctions = new Set(['is_crm_owner']); // uses Supabase auth.uid(); owner check now lives in lib/auth.ts
const out = [];
out.push(`-- CREST CRM schema for the Azure PostgreSQL database (Phase 1).
--
-- Generated ${new Date().toISOString().slice(0, 10)} from the live Supabase database (PostgreSQL ${s.server}),
-- read from its catalog, so it includes the foreign-key ON DELETE rules, CHECK
-- constraints and indexes that the baseline migration does not capture.
--
-- Left out on purpose (Supabase-only, or replaced by code):
--   row-level security and its ${s.policies.length} policies, is_crm_owner() (auth.uid()),
--   grants/revokes for anon/authenticated, storage buckets, the supabase_realtime
--   publication, and the pgcrypto/uuid-ossp extensions (gen_random_uuid() is built
--   into PostgreSQL 13+).
--
-- Run once on an empty database, as the user the app connects with:
--   the whole file is one transaction, so it either all applies or nothing does.

begin;
`);

const q = id => /^[a-z_][a-z0-9_]*$/.test(id) ? id : `"${id}"`;
for (const t of order) {
  const cols = s.columns.filter(c => c.tbl === t);
  const cons = s.constraints.filter(c => c.tbl === t && c.contype !== 'f');
  const lines = cols.map(c => `  ${q(c.col)} ${c.typ}${c.nn ? ' not null' : ''}${c.def != null ? ' default ' + c.def : ''}`);
  for (const k of cons) lines.push(`  constraint ${q(k.conname)} ${k.def}`);
  out.push(`create table public.${q(t)} (\n${lines.join(',\n')}\n);\n`);
}

out.push('-- Foreign keys (added after all tables exist).');
for (const t of order) {
  for (const k of s.constraints.filter(c => c.tbl === t && c.contype === 'f')) {
    out.push(`alter table public.${q(t)} add constraint ${q(k.conname)} ${k.def.replace(/REFERENCES (?!public\.)/, 'REFERENCES public.')};`);
  }
}

out.push('\n-- Indexes (besides the ones behind primary keys and unique constraints).');
for (const i of s.indexes) out.push(i.indexdef + ';');

out.push('\n-- Functions.');
for (const f of s.functions.filter(f => !skipFunctions.has(f.proname))) out.push(f.def.trim() + ';\n');

out.push('-- Triggers.');
for (const t of s.triggers) out.push(t.def + ';');

out.push('\ncommit;\n');

const target = 'A:/CREST/CRM/investor-crm/azure/schema.sql';
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out.join('\n'));
console.log('wrote', target, out.join('\n').split('\n').length, 'lines');
