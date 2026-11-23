// Copies the live database into a local PostgreSQL on this PC, for testing
// migrations and encryption without touching live data.
//
//   node azure/copy-to-local.mjs
//
// Needs PostgreSQL 16 installed locally (its pg_dump/pg_restore are used) and
// in .env.local:
//   LOCAL_DATABASE_URL=postgresql://postgres:<local password>@localhost:5432/crest_crm_local
//
// The live database is only read (pg_dump). The local database named in
// LOCAL_DATABASE_URL is dropped and created again. The dump file is written to
// the system temp folder and deleted afterwards. Prints no data and no passwords.
//
// Afterwards, add --local to the other scripts to work on the copy, e.g.
//   node azure/encrypt-columns.mjs 1 --dry-run --local
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { confirmDatabase, loadEnv, localDatabaseUrl, run } from "./lib/script-env.mjs";

function findPgBin() {
  const base = "C:\\Program Files\\PostgreSQL";
  const versions = fs.existsSync(base)
    ? fs.readdirSync(base).filter((name) => fs.existsSync(path.join(base, name, "bin", "pg_dump.exe")))
    : [];
  const preferred = versions.sort((a, b) => Number(b) - Number(a))[0];
  if (!preferred) throw new Error("PostgreSQL is not installed (no pg_dump in C:\\Program Files\\PostgreSQL\\<version>\\bin).");
  if (Number(preferred) < 16) throw new Error(`PostgreSQL ${preferred} is too old; the server runs 16. Install 16.`);
  return path.join(base, preferred, "bin");
}

/** Connection settings as PG* environment variables, so passwords never appear on a command line. */
function pgEnv(url, { ssl }) {
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, ""),
    PGSSLMODE: ssl,
  };
}

function runTool(bin, tool, args, env) {
  const result = spawnSync(path.join(bin, `${tool}.exe`), args, { env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${tool} failed: ${(result.stderr || result.error?.message || "").trim().split("\n").slice(-3).join(" ")}`);
  }
  return result;
}

async function rowCounts(client) {
  const { rows } = await client.query(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
  );
  const counts = {};
  for (const { table_name } of rows) {
    const quoted = `"${table_name.replace(/"/g, '""')}"`;
    counts[table_name] = Number((await client.query(`select count(*) from public.${quoted}`)).rows[0].count);
  }
  return counts;
}

run(async () => {
  loadEnv();
  const bin = findPgBin();
  const live = new URL(process.env.AZURE_CONNECTION_STRING.replace(/^postgresql\+\w+:/, "postgresql:"));
  const local = localDatabaseUrl();
  const localName = local.pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]+$/.test(localName)) throw new Error("Use a simple local database name (letters, digits, _).");
  if (localName === live.pathname.replace(/^\//, "") && live.hostname === local.hostname) {
    throw new Error("LOCAL_DATABASE_URL is the same as the live database.");
  }

  console.log(`Copy from: ${live.hostname}${live.pathname} (read only)`);
  console.log(`Copy to:   ${local.hostname}/${localName} (dropped and created again)`);
  await confirmDatabase(localName, "");

  // 1. Create the local database fresh.
  const admin = new pg.Client({ connectionString: Object.assign(new URL(local), { pathname: "/postgres" }).toString() });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${localName}" with (force)`);
    await admin.query(`create database "${localName}"`);
  } finally {
    await admin.end();
  }

  // 2. Dump live -> temp file -> restore locally.
  const dumpFile = path.join(os.tmpdir(), `crest-crm-copy-${Date.now()}.dump`);
  try {
    console.log("Dumping the live database...");
    const liveSsl = ["localhost", "127.0.0.1", "::1"].includes(live.hostname) ? "disable" : "require";
    runTool(bin, "pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--file=${dumpFile}`], pgEnv(live, { ssl: liveSsl }));
    console.log("Restoring into the local database...");
    if (!fs.existsSync(dumpFile) || fs.statSync(dumpFile).size === 0) throw new Error("pg_dump produced an empty file.");
    runTool(bin, "pg_restore", ["--no-owner", "--no-privileges", `--dbname=${localName}`, dumpFile], pgEnv(local, { ssl: "disable" }));
  } finally {
    fs.rmSync(dumpFile, { force: true });
  }

  // 3. Compare row counts.
  const liveClient = new pg.Client({
    connectionString: live.toString(),
    ssl: liveSslOption(live),
  });
  const localClient = new pg.Client({ connectionString: local.toString() });
  await Promise.all([liveClient.connect(), localClient.connect()]);
  try {
    const [liveCounts, localCounts] = await Promise.all([rowCounts(liveClient), rowCounts(localClient)]);
    let same = true;
    console.log("\nRows per table (live / local):");
    for (const table of Object.keys(liveCounts)) {
      const ok = liveCounts[table] === localCounts[table];
      same &&= ok;
      console.log(`  ${table.padEnd(24)} ${String(liveCounts[table]).padStart(6)} / ${String(localCounts[table] ?? "-").padStart(6)}${ok ? "" : "  DIFFERENT"}`);
    }
    console.log(same ? "\nLocal copy is complete." : "\nSome tables differ (rows may have changed on live while copying).");
  } finally {
    await Promise.all([liveClient.end(), localClient.end()]);
  }
});

function liveSslOption(url) {
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ? undefined
    : { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "1" };
}
