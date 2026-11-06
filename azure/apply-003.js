// Applies azure/003_contact_sections.sql to the database in .env.local.
//   node azure/apply-003.js --dry-run   runs it, prints the result, then rolls back (nothing saved)
//   node azure/apply-003.js             runs it for real
// Prints counts only, never secrets.
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const { Client } = require(path.join(root, 'node_modules/pg'));

const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^['"]|['"]$/g, '')]));
const url = new URL(env.AZURE_CONNECTION_STRING.replace(/^postgresql\+\w+:/, 'postgresql:'));
url.searchParams.delete('sslmode');
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
const dryRun = process.argv.includes('--dry-run');

// The file's own begin/commit are removed so this script controls the transaction.
const sql = fs.readFileSync(path.join(__dirname, '003_contact_sections.sql'), 'utf8')
  .replace(/^\s*begin;\s*$/m, '')
  .replace(/^\s*commit;\s*$/m, '');

(async () => {
  console.log(`Database: ${url.hostname}${url.pathname}${dryRun ? '  (DRY RUN, will roll back)' : ''}`);
  const c = new Client({
    connectionString: url.toString(),
    ssl: isLocal ? undefined : { rejectUnauthorized: env.DATABASE_SSL_NO_VERIFY !== '1' },
  });
  await c.connect();
  try {
    const exists = (await c.query("select to_regclass('public.contact_sections') as t")).rows[0].t;
    if (exists) throw new Error('contact_sections already exists: this migration has already been applied.');

    await c.query('begin');
    await c.query(sql);
    const sections = (await c.query(
      `select s.name, count(c.id)::int as contacts
         from public.contact_sections s left join public.contacts c on c.section_id = s.id
        group by s.name, s.sort_order order by s.sort_order`,
    )).rows;
    const { total, without } = (await c.query(
      'select count(*)::int as total, count(*) filter (where section_id is null)::int as without from public.contacts',
    )).rows[0];
    for (const s of sections) console.log(`  section ${s.name}: ${s.contacts} contacts`);
    console.log(`  contacts total: ${total}, without a section: ${without}`);

    if (dryRun) {
      await c.query('rollback');
      console.log('Dry run finished: rolled back, nothing saved.');
    } else {
      await c.query('commit');
      console.log('Applied.');
    }
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
})().catch(e => {
  console.log('Not applied:', e.message);
  process.exitCode = 1;
});
