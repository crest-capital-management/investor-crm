// Reads the live Supabase public schema (read-only transaction) into schema.json. Prints no credentials.
const path = require('path');
const fs = require('fs');
const root = 'A:/CREST/CRM/investor-crm';
const { Client } = require(path.join(root, 'node_modules/pg'));
const line = fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/).find(x => x.startsWith('SUPABASE_DB_URL='));
const conn = line.slice(16).trim().replace(/^['"]|['"]$/g, '');
const ca = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : undefined;

(async () => {
  const c = new Client({ connectionString: conn.replace(/[?&]sslmode=[^&]*/, ''), ssl: ca ? { ca } : true, connectionTimeoutMillis: 10000 });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;
  try {
    await c.query('begin read only');
    const out = {};
    out.server = (await q("select current_setting('server_version') v"))[0].v;
    out.extensions = await q("select extname, n.nspname schema from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1");
    out.types = await q(`select t.typname, t.typtype, array_agg(e.enumlabel order by e.enumsortorder) labels
      from pg_type t join pg_namespace n on n.oid=t.typnamespace left join pg_enum e on e.enumtypid=t.oid
      where n.nspname='public' and t.typtype in ('e','d','c') and not exists (select 1 from pg_class r where r.reltype=t.oid)
      group by 1,2`);
    out.tables = await q(`select c.relname, c.relkind, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p','v','m','S') order by c.relkind, c.relname`);
    out.columns = await q(`select c.relname tbl, a.attnum, a.attname col, format_type(a.atttypid,a.atttypmod) typ, a.attnotnull nn,
      pg_get_expr(d.adbin,d.adrelid) def, a.attidentity ident, a.attgenerated gen
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped order by 1,2`);
    out.constraints = await q(`select c.relname tbl, k.conname, k.contype, pg_get_constraintdef(k.oid) def
      from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' order by 1, case k.contype when 'p' then 0 when 'u' then 1 when 'c' then 2 when 'f' then 3 else 4 end, 2`);
    out.indexes = await q(`select i.tablename tbl, i.indexname, i.indexdef from pg_indexes i
      where i.schemaname='public' and not exists (select 1 from pg_constraint k where k.conname=i.indexname and k.connamespace='public'::regnamespace)
      order by 1,2`);
    out.functions = await q(`select p.proname, pg_get_function_identity_arguments(p.oid) args, pg_get_functiondef(p.oid) def
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p') order by 1`);
    out.triggers = await q(`select c.relname tbl, t.tgname, pg_get_triggerdef(t.oid) def from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by 1,2`);
    out.views = await q(`select viewname, definition from pg_views where schemaname='public'`);
    out.policies = await q(`select tablename, policyname from pg_policies where schemaname='public' order by 1,2`);
    out.counts = {};
    for (const t of out.tables.filter(t => t.relkind === 'r')) {
      out.counts[t.relname] = (await q(`select count(*)::int n from public."${t.relname}"`))[0].n;
    }
    await c.query('rollback');
    fs.writeFileSync(path.join(__dirname, 'schema.json'), JSON.stringify(out, null, 1));
    console.log('server', out.server);
    console.log('extensions', out.extensions.map(e => e.extname + '@' + e.schema).join(', '));
    console.log('types', JSON.stringify(out.types));
    console.log('relations', out.tables.map(t => t.relname + ':' + t.relkind).join(', '));
    console.log('counts', JSON.stringify(out.counts));
    console.log('constraints', out.constraints.length, 'indexes', out.indexes.length, 'functions', out.functions.map(f => f.proname).join(', '));
    console.log('triggers', out.triggers.map(t => t.tbl + '.' + t.tgname).join(', '), 'views', out.views.length, 'policies', out.policies.length);
  } finally {
    await c.end();
  }
})().catch(e => console.log('failed:', e.code || '', e.message.split('\n')[0]));
