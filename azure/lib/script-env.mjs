// Shared setup for the scripts in azure/: reads .env.local (values already in
// the environment win), connects to the database the same way the app does,
// and asks for confirmation. Prints no secrets.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

/**
 * Reads .env.local. With --local on the command line, the script works on the
 * local test copy instead: LOCAL_DATABASE_URL (must be on this PC) replaces
 * AZURE_CONNECTION_STRING. See azure/copy-to-local.mjs.
 */
export function loadEnv() {
  const file = path.join(root, ".env.local");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }
  if (isLocalRun()) {
    process.env.AZURE_CONNECTION_STRING = localDatabaseUrl().toString();
    delete process.env.DATABASE_URL;
  }
}

export function isLocalRun() {
  return process.argv.includes("--local");
}

/** LOCAL_DATABASE_URL from .env.local, refused unless it points at this PC. */
export function localDatabaseUrl() {
  const raw = process.env.LOCAL_DATABASE_URL;
  if (!raw) {
    throw new Error("LOCAL_DATABASE_URL is not set in .env.local (postgresql://postgres:<password>@localhost:5432/crest_crm_local).");
  }
  const url = new URL(raw);
  if (!LOCAL_HOSTS.includes(url.hostname)) throw new Error("LOCAL_DATABASE_URL must point at this PC (localhost).");
  return url;
}

export async function connect() {
  const raw = process.env.AZURE_CONNECTION_STRING ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("AZURE_CONNECTION_STRING is not set.");
  const url = new URL(raw.replace(/^postgresql\+\w+:/, "postgresql:"));
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: isLocal ? undefined : { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "1" },
  });
  await client.connect();
  const database = url.pathname.replace(/^\//, "");
  return { client, host: url.hostname, database, label: `${url.hostname}/${database}` };
}

export function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Makes the person type the database name before anything is changed. */
export async function confirmDatabase(database, what) {
  const typed = await ask(`${what}\nType the database name (${database}) to continue: `);
  if (typed !== database) throw new Error("Cancelled: the name did not match.");
}

export function flag(name) {
  return process.argv.includes(name);
}

export function option(name, fallback) {
  const hit = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
}

export function run(main) {
  main().catch((error) => {
    console.error(`\nStopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
