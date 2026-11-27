// Removes a login from crm_users (the person can no longer sign in).
// Run it yourself in a terminal:  node azure/delete-user.mjs   (add --local for the local test copy)
// It lists the logins, asks which email to remove and asks you to type the
// database name to confirm. CRM data (contacts, notes, messages, ...) is not
// tied to logins and is not touched. Refuses to remove the last login.
// Once package 7a is live, the person's open sessions end within about 10
// seconds (lib/session.ts); before that, an open session lasts until it expires.
// To add a login or reset a password: node azure/set-password.mjs
import readline from "node:readline";
import { connect, loadEnv, run } from "./lib/script-env.mjs";

// One reader for every question, so answers that arrive together (pasted or
// piped) are not lost between questions (same as set-password.mjs).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const lines = rl[Symbol.asyncIterator]();

async function ask(question) {
  process.stdout.write(question);
  const { value, done } = await lines.next();
  if (done) throw new Error("No answer was given.");
  return value.trim();
}

run(async () => {
  loadEnv();
  const { client, database, label } = await connect();
  try {
    console.log(`Database: ${label}\n`);
    const { rows } = await client.query(
      "select email, created_at, last_login_at from public.crm_users order by created_at",
    );
    console.log("Logins:");
    for (const row of rows) {
      const last = row.last_login_at ? row.last_login_at.toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never";
      console.log(`  ${row.email}   (created ${row.created_at.toISOString().slice(0, 10)}, last sign-in ${last})`);
    }

    const email = (await ask("\nEmail of the login to remove: ")).toLowerCase();
    if (!rows.some((row) => row.email === email)) throw new Error(`There is no login with the email "${email}".`);
    if (rows.length <= 1) throw new Error("This is the only login; removing it would lock everyone out.");

    const typed = await ask(`\nAbout to remove the login ${email} from ${label}.\nType the database name (${database}) to continue: `);
    if (typed !== database) throw new Error("Cancelled: the name did not match.");

    const { rowCount } = await client.query("delete from public.crm_users where email = $1", [email]);
    console.log(rowCount === 1 ? `Removed the login ${email}.` : "Nothing was removed.");
  } finally {
    rl.close();
    await client.end();
  }
});
