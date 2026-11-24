// Creates a login (or changes that email's password) in crm_users.
// Run it yourself in a terminal:  node azure/set-password.mjs   (add --local for the local test copy)
// It asks for the email and the password (hidden while typing) and stores only a
// bcrypt hash. An email that already exists keeps its id and only gets a new password;
// a new email gets a new account (the first one ever created takes CRM_OWNER_ID as its id).
// The name is stored encrypted (TSK-38 phase 2), so it needs PII_ENCRYPTION_SECRET_KEY.
import crypto from "node:crypto";
import readline from "node:readline";
import bcrypt from "bcryptjs";
import { encryptField, setKeyring } from "../lib/encryption.ts";
import { KEY_SETTING, loadKeyring, verifyKeyFingerprints } from "../lib/keys.ts";
import { connect, loadEnv, run } from "./lib/script-env.mjs";

// One reader for every question, so answers that arrive together (pasted or
// piped) are not lost between questions. Hidden answers are not echoed.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();
let hiding = false;
const writeToOutput = rl._writeToOutput.bind(rl);
rl._writeToOutput = (text) => {
  if (!hiding) writeToOutput(text);
};

async function ask(question, { hidden = false } = {}) {
  process.stdout.write(question);
  hiding = hidden;
  const { value, done } = await lines.next();
  hiding = false;
  if (hidden) process.stdout.write("\n");
  if (done) throw new Error("No answer was given.");
  return value;
}

run(async () => {
  loadEnv();
  const keyring = await loadKeyring(process.env);
  if (!keyring) throw new Error(`${KEY_SETTING} is not set (in .env.local); it is needed to store the name.`);
  const ownerId = process.env.CRM_OWNER_ID?.toLowerCase();

  const { client, label } = await connect();
  try {
    console.log(`Database: ${label}`);
    await verifyKeyFingerprints(keyring, (sql, params) => client.query(sql, params));
    setKeyring(keyring);

    const email = (await ask("Email: ")).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("That does not look like an email address.");
    const name = (await ask("Name shown in the CRM (optional, press Enter to skip): ")).trim() || null;
    const password = await ask("New password (hidden): ", { hidden: true });
    if (password.length < 12) throw new Error("Use at least 12 characters.");
    if ((await ask("Type it again (hidden): ", { hidden: true })) !== password) {
      throw new Error("The two passwords do not match.");
    }
    const hash = await bcrypt.hash(password, 12);

    const existing = (await client.query("select id from public.crm_users where email = $1", [email])).rows[0];
    if (existing) {
      await client.query(
        `update public.crm_users
            set name = coalesce($2, name), password_hash = $3, password_updated_at = now()
          where id = $1`,
        [existing.id, encryptField(name), hash],
      );
      console.log(`Password changed for ${email}.`);
    } else {
      // The very first login takes the owner's id (if set and unused); every other one gets a new id.
      const ownerTaken = ownerId
        ? (await client.query("select 1 from public.crm_users where id = $1", [ownerId])).rowCount > 0
        : true;
      const id = ownerId && !ownerTaken ? ownerId : crypto.randomUUID();
      await client.query("insert into public.crm_users (id, email, name, password_hash) values ($1, $2, $3, $4)", [
        id,
        email,
        encryptField(name),
        hash,
      ]);
      console.log(`Login created for ${email}. It can sign in now.`);
    }
  } finally {
    rl.close();
    await client.end();
  }
});
