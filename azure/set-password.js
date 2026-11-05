// Creates the owner's login, or changes its password, in crm_users (Phase 2).
// Run it yourself in a terminal:  node azure/set-password.js
// It asks for the email and the password (hidden while typing) and stores only a
// bcrypt hash. The account gets the id in CRM_OWNER_ID, so the owner check works.
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const root = path.join(__dirname, '..');
const { Client } = require(path.join(root, 'node_modules/pg'));
const bcrypt = require(path.join(root, 'node_modules/bcryptjs'));

const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^['"]|['"]$/g, '')]));
const ownerId = env.CRM_OWNER_ID?.toLowerCase();
const url = new URL(env.AZURE_CONNECTION_STRING.replace(/^postgresql\+\w+:/, 'postgresql:'));
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = text => { if (text.startsWith(question)) rl.output.write(question); };
    }
    rl.question(question, answer => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  if (!ownerId) throw new Error('CRM_OWNER_ID is missing from .env.local.');
  console.log(`Database: ${url.hostname}${url.pathname}`);

  const email = (await ask('Email: ')).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('That does not look like an email address.');
  const name = (await ask('Name shown in the CRM (optional, press Enter to skip): ')).trim() || null;
  const password = await ask('New password (hidden): ', { hidden: true });
  if (password.length < 12) throw new Error('Use at least 12 characters.');
  if ((await ask('Type it again (hidden): ', { hidden: true })) !== password) throw new Error('The two passwords do not match.');

  const hash = await bcrypt.hash(password, 12);
  const c = new Client({
    connectionString: url.toString(),
    ssl: isLocal ? undefined : { rejectUnauthorized: env.DATABASE_SSL_NO_VERIFY !== '1' },
  });
  await c.connect();
  try {
    const row = (await c.query(
      `insert into public.crm_users (id, email, name, password_hash)
       values ($1, $2, $3, $4)
       on conflict (id) do update
         set email = excluded.email,
             name = coalesce(excluded.name, crm_users.name),
             password_hash = excluded.password_hash,
             password_updated_at = now()
       returning (xmax = 0) as created`,
      [ownerId, email, name, hash],
    )).rows[0];
    console.log(row.created ? 'Login created. You can now sign in with this email and password.' : 'Password changed.');
  } finally {
    await c.end();
  }
})().catch(e => {
  console.log('Not saved:', e.message);
  process.exitCode = 1;
});
