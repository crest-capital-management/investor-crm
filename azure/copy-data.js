// Copies all CRM rows from live Supabase (read-only snapshot) into crest_crm, then verifies counts and checksums.
//   node azure/copy-data.js                first copy; refuses unless crest_crm is empty
//   node azure/copy-data.js --replace      final re-sync at switch-over: empties the 11 CRM tables and copies
//                                          again, all in one transaction (crm_users, the logins, is not touched)
//   node azure/copy-data.js --verify-only  only compares
// Values travel as raw text, so timestamps keep their microseconds and arrays/jsonb are re-parsed by PostgreSQL unchanged.
const path = require('path');
const fs = require('fs');
const root = 'A:/CREST/CRM/investor-crm';
const { Client } = require(path.join(root, 'node_modules/pg'));
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^['"]|['"]$/g, '')]));
const azureUrl = new URL(env.AZURE_CONNECTION_STRING.replace(/^postgresql\+\w+:/, 'postgresql:'));
if (azureUrl.pathname !== '/crest_crm') throw new Error('refusing: AZURE_CONNECTION_STRING does not point at crest_crm');
const verifyOnly = process.argv[2] === '--verify-only';
const replace = process.argv[2] === '--replace';

const raw = { getTypeParser: () => v => v };
const src = new Client({ connectionString: env.SUPABASE_DB_URL.replace(/[?&]sslmode=[^&]*/, ''),
  ssl: { ca: fs.readFileSync(path.join(root, 'prod-ca-2021.crt'), 'utf8') }, types: raw });
const dst = new Client({ connectionString: azureUrl.toString(),
  ssl: { rejectUnauthorized: env.DATABASE_SSL_NO_VERIFY !== '1' }, types: raw });

// Parents before children so foreign keys are checked as rows arrive.
const tables = ['contacts', 'groups', 'templates', 'broadcasts', 'broadcast_recipients', 'contact_groups',
  'follow_ups', 'interactions', 'portfolio_updates', 'whatsapp_messages', 'app_settings'];

const columnsOf = async (c, t) => (await c.query(
  `select attname from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum`,
  [`public.${t}`])).rows.map(r => r.attname);
const checksum = async (c, t, cols) => (await c.query(
  `select count(*)::text n, coalesce(md5(string_agg(x, E'\\n' order by x)), '-') h
   from (select row(${cols.map(x => `"${x}"`).join(',')})::text x from public."${t}") s`)).rows[0];

(async () => {
  await src.connect();
  await dst.connect();
  try {
    await src.query('begin isolation level repeatable read read only'); // one consistent snapshot of all tables
    if (!verifyOnly) {
      const existing = (await dst.query(`select sum(n)::int n from (${tables.map(t => `select count(*) n from public."${t}"`).join(' union all ')}) s`)).rows[0].n;
      if (existing > 0 && !replace) throw new Error(`refusing: crest_crm already has ${existing} rows (use --replace for the final re-sync)`);
      await dst.query('begin');
      if (existing > 0) {
        // Same transaction as the copy: if anything below fails, the old rows come back untouched.
        await dst.query(`truncate table ${tables.map(t => `public."${t}"`).join(', ')}`);
        console.log(`emptied the CRM tables (${existing} rows) to replace them`);
      }
      // The trigger would rewrite contacts.last_message_*; those values are copied as they are.
      await dst.query('alter table public.whatsapp_messages disable trigger whatsapp_messages_touch_contact');
      for (const t of tables) {
        const cols = await columnsOf(src, t);
        const dcols = await columnsOf(dst, t);
        if (cols.join() !== dcols.join()) throw new Error(`column mismatch in ${t}`);
        const rows = (await src.query(`select ${cols.map(x => `"${x}"`).join(',')} from public."${t}"`)).rows;
        for (let i = 0; i < rows.length; i += 500) {
          const batch = rows.slice(i, i + 500);
          const params = [];
          const values = batch.map(r => `(${cols.map(col => { params.push(r[col]); return `$${params.length}`; }).join(',')})`);
          await dst.query(`insert into public."${t}" (${cols.map(x => `"${x}"`).join(',')}) values ${values.join(',')}`, params);
        }
        console.log('copied', t.padEnd(22), rows.length);
      }
      await dst.query('alter table public.whatsapp_messages enable trigger whatsapp_messages_touch_contact');
      await dst.query('commit');
    }
    console.log('--- verify (same snapshot on Supabase) ---');
    let ok = true;
    for (const t of tables) {
      const cols = await columnsOf(src, t);
      const a = await checksum(src, t, cols), b = await checksum(dst, t, cols);
      const same = a.n === b.n && a.h === b.h;
      ok = ok && same;
      console.log(t.padEnd(22), `supabase ${a.n}`.padEnd(15), `azure ${b.n}`.padEnd(12), same ? 'identical' : 'DIFFERENT');
    }
    const trg = (await dst.query(`select tgenabled from pg_trigger where tgname='whatsapp_messages_touch_contact'`)).rows[0].tgenabled;
    console.log('trigger enabled again:', trg === 'O', '| all identical:', ok);
    await src.query('rollback');
  } catch (e) {
    await dst.query('rollback').catch(() => {});
    throw e;
  } finally {
    await src.end();
    await dst.end();
  }
})().catch(e => console.log('failed:', e.code || '', e.message.split('\n')[0]));
