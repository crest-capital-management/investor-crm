// Creates a login (or changes that email's password) in crm_users.
// Run it yourself in a terminal:  node azure/set-password.js
// It asks for the email and the password (hidden while typing) and stores only a
// bcrypt hash. An email that already exists keeps its id and only gets a new password;
// a new email gets a new account (the first one ever created takes CRM_OWNER_ID as its id).
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
    const existing = (await c.query('select id from public.crm_users where email = $1', [email])).rows[0];
    if (existing) {
      await c.query(
        `update public.crm_users
            set name = coalesce($2, name), password_hash = $3, password_updated_at = now()
          where id = $1`,
        [existing.id, name, hash],
      );
      console.log('Password changed for ' + email + '.');
    } else {
      // The very first login takes the owner's id (if set and unused); every other one gets a new id.
      const ownerTaken = ownerId
        ? (await c.query('select 1 from public.crm_users where id = $1', [ownerId])).rowCount > 0
        : true;
      const id = ownerId && !ownerTaken ? ownerId : require('crypto').randomUUID();
      await c.query(
        'insert into public.crm_users (id, email, name, password_hash) values ($1, $2, $3, $4)',
        [id, email, name, hash],
      );
      console.log('Login created for ' + email + '. It can sign in now.');
    }
  } finally {
    await c.end();
  }
})().catch(e => {
  console.log('Not saved:', e.message);
  process.exitCode = 1;
});
