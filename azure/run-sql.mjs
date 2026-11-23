// Applies one SQL file (e.g. a migration) to the database in .env.local.
//   node azure/run-sql.mjs azure/migrations/001_encryption.sql
// The file should contain its own begin/commit. Asks you to type the database
// name first, since .env.local may point at the live database.
import fs from "node:fs";
import path from "node:path";
import { connect, confirmDatabase, loadEnv, root, run } from "./lib/script-env.mjs";

run(async () => {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: node azure/run-sql.mjs <file.sql>");
  const sql = fs.readFileSync(path.resolve(root, file), "utf8");

  loadEnv();
  const { client, database, label } = await connect();
  try {
    await confirmDatabase(database, `About to apply ${file} to ${label}.`);
    await client.query(sql);
    console.log(`Applied ${file}.`);
  } finally {
    await client.end();
  }
});
