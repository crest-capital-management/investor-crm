// Encrypts one phase of personal-data columns in place (TSK-38).
//
//   node azure/encrypt-columns.mjs <phase 1|2|3> --dry-run      count + test, change nothing
//   node azure/encrypt-columns.mjs <phase> --hash-only           only fill phone_hash/email_hash
//   node azure/encrypt-columns.mjs <phase>                       encrypt (and fill hashes)
//   node azure/encrypt-columns.mjs <phase> --verify-only         check every encrypted value decrypts
// Options: --batch=500, --max-backup-age-hours=6, --skip-backup-check (test copies only).
//
// Only run a phase after the app code that reads it has been deployed (the
// app reads plain text and encrypted values alike, so code goes first, data second).
//
// Safe to re-run: values already encrypted are skipped. Each batch is one
// transaction; a value is only written after it was decrypted back to the
// original in memory, and only if the row did not change meanwhile.
// Refuses to run when: the keys don't match encryption_keys, a column has an
// unexpected type, a trigger fires on updates of these columns (it would see
// ciphertext), or there is no backup from the last few hours. Prints counts
// only, never data.
import { BlobServiceClient } from "@azure/storage-blob";
import { blindIndex, decryptField, encryptField, isEncrypted, normalizeEmail, setKeyring } from "../lib/encryption.ts";
import { loadKeyring, verifyKeyFingerprints } from "../lib/keys.ts";
import { normalizeToLocalPhone } from "../lib/whatsapp.ts";
import { connect, confirmDatabase, flag, loadEnv, option, run } from "./lib/script-env.mjs";

const phoneHash = { column: "phone_hash", kind: "phone" };
const emailHash = { column: "email_hash", kind: "email" };

// The 26 columns from the TSK-38 plan. `jsonb` columns keep their type: the
// encrypted text is stored as a JSON string (to_jsonb), and lib/pii.ts
// withDecryptedAnalysis / decryptJson read both forms. contacts.tags (text[])
// needs its own change in package 4 before phase 3 can run.
const PHASES = {
  1: [
    { table: "contacts", column: "name" },
    { table: "contacts", column: "phone", hash: phoneHash },
    { table: "whatsapp_messages", column: "message_text" },
    { table: "whatsapp_messages", column: "phone", hash: phoneHash },
    { table: "broadcast_recipients", column: "name" },
    { table: "broadcast_recipients", column: "phone", hash: phoneHash },
    { table: "broadcasts", column: "message_text" },
    { table: "portfolio_updates", column: "analysis", jsonb: true },
    { table: "follow_ups", column: "message" },
  ],
  2: [
    { table: "contacts", column: "email", hash: emailHash },
    { table: "contacts", column: "notes" },
    { table: "contacts", column: "whatsapp_summary" },
    { table: "interactions", column: "note" },
    { table: "whatsapp_messages", column: "profile_name" },
    { table: "broadcast_recipients", column: "email" },
    { table: "crm_users", column: "name" },
    { table: "app_settings", column: "reminder_email_to" },
  ],
  3: [
    { table: "contacts", column: "company" },
    { table: "contacts", column: "last_message_text" },
    { table: "contacts", column: "ai_score_reason" },
    { table: "contacts", column: "manual_score_reason" },
    { table: "contacts", column: "tags" },
    { table: "portfolio_updates", column: "title" },
    { table: "portfolio_updates", column: "file_path" },
    { table: "portfolio_updates", column: "file_name" },
    { table: "whatsapp_messages", column: "media_url" },
  ],
};

// Identifiers come only from the fixed list above; quote them anyway.
const ident = (name) => `"${name.replace(/"/g, '""')}"`;
const fieldOf = (spec) => `${spec.table}.${spec.column}`;

/**
 * SQL pieces for one column:
 *   value     the stored text (for jsonb: the JSON string's content, else the JSON text)
 *   present   the column holds something worth encrypting
 *   write(p)  the expression stored for encrypted text in parameter p
 */
function sqlFor(spec) {
  const column = ident(spec.column);
  if (spec.jsonb) {
    const value = `(case when jsonb_typeof(${column}) = 'string' then ${column} #>> '{}' else ${column}::text end)`;
    return { value, present: `(${column} is not null and jsonb_typeof(${column}) <> 'null')`, write: (p) => `to_jsonb(${p}::text)` };
  }
  return { value: column, present: `(${column} is not null and ${column} <> '')`, write: (p) => p };
}

function hashOf(spec, plain) {
  if (!spec.hash || plain == null) return null;
  const normalized = spec.hash.kind === "phone" ? normalizeToLocalPhone(plain) : normalizeEmail(plain);
  return blindIndex(spec.hash.kind, normalized);
}

/** A problem message per column that is missing or of a type this script can't handle. */
async function columnProblems(client, specs) {
  const problems = new Map();
  for (const spec of specs) {
    const columns = [[spec.column, spec.jsonb ? ["jsonb"] : ["text", "character varying"]]];
    if (spec.hash) columns.push([spec.hash.column, ["text"]]);
    for (const [column, allowed] of columns) {
      const { rows } = await client.query(
        `select data_type from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`,
        [spec.table, column],
      );
      if (!rows.length) problems.set(spec, `${spec.table}.${column} does not exist (apply the migrations first)`);
      else if (!allowed.includes(rows[0].data_type)) {
        problems.set(spec, `${spec.table}.${column} is ${rows[0].data_type}; expected ${allowed.join(" or ")}`);
      }
    }
  }
  return problems;
}

/** Triggers that would fire on the updates this run makes (UPDATE of these columns). */
async function triggerProblem(client, specs, hashOnly) {
  const found = [];
  for (const spec of specs) {
    const columns = hashOnly ? [spec.hash.column] : [spec.column, ...(spec.hash ? [spec.hash.column] : [])];
    const { rows } = await client.query(
      `select t.tgname as trigger_name
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = $1 and not t.tgisinternal
          and (t.tgtype & 16) <> 0
          and (cardinality(t.tgattr::int2[]) = 0
               or exists (select 1 from pg_attribute a
                           where a.attrelid = c.oid and a.attname = any($2::text[]) and a.attnum = any(t.tgattr::int2[])))`,
      [spec.table, columns],
    );
    for (const row of rows) found.push(`${spec.table}.${row.trigger_name}`);
  }
  if (!found.length) return null;
  return `triggers fire when these columns are updated and would see the ciphertext: ${[...new Set(found)].join(", ")}`;
}

async function checkRecentBackup(maxAgeHours) {
  const connection = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connection) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set, so the backup can't be checked.");
  const container = BlobServiceClient.fromConnectionString(connection).getContainerClient("backups");
  let newest = null;
  for await (const blob of container.listBlobsFlat()) {
    if (!blob.name.startsWith("crest-crm-backup-")) continue;
    const modified = blob.properties.lastModified;
    if (modified && (!newest || modified > newest.modified)) newest = { name: blob.name, modified };
  }
  const ageHours = newest ? (Date.now() - newest.modified.getTime()) / 3_600_000 : Infinity;
  if (ageHours > maxAgeHours) {
    throw new Error(
      `No backup from the last ${maxAgeHours} h${newest ? ` (newest: ${newest.name})` : ""}. ` +
        "Use Settings -> Back up now, then run this again.",
    );
  }
  console.log(`Backup found: ${newest.name} (${ageHours.toFixed(1)} h old).`);
}

/** Processes one column in id order, one transaction per batch. */
async function processColumn(client, spec, { hashOnly, dryRun, batchSize }) {
  const table = ident(spec.table);
  const column = ident(spec.column);
  const { value, present, write } = sqlFor(spec);
  const hashColumn = spec.hash ? ident(spec.hash.column) : null;
  if (hashOnly && !hashColumn) return null;
  const needsHash = hashColumn ? `(${hashColumn} is null and ${present})` : "false";
  const needsEncrypt = `(${present} and ${value} !~ '^enc:v1:')`;
  const needs = hashOnly ? needsHash : `(${needsEncrypt} or ${needsHash})`;

  const stats = { encrypted: 0, hashed: 0, changedMeanwhile: 0, noHash: 0 };
  let lastId = null;
  for (;;) {
    await client.query("begin");
    try {
      const { rows } = await client.query(
        `select id::text as id, ${value} as value${hashColumn ? `, ${hashColumn} as hash` : ""}
           from public.${table}
          where ${needs} and ($1::text is null or id::text > $1::text)
          order by id::text
          limit $2
          for update`,
        [lastId, batchSize],
      );
      if (!rows.length) {
        await client.query("rollback");
        break;
      }

      for (const row of rows) {
        const plain = decryptField(row.value);
        const encrypted = hashOnly || isEncrypted(row.value) ? row.value : encryptField(row.value);
        if (decryptField(encrypted) !== plain) {
          throw new Error(`Round-trip check failed in ${fieldOf(spec)} (row ${row.id}); nothing in this batch was saved.`);
        }
        const hash = hashColumn ? (row.hash ?? hashOf(spec, plain)) : null;
        if (hashColumn && !hash) stats.noHash += 1;

        const encrypting = encrypted !== row.value;
        if (encrypting) stats.encrypted += 1;
        if (hashColumn && hash && !row.hash) stats.hashed += 1;
        if (dryRun || (!encrypting && (!hashColumn || row.hash || !hash))) continue;

        // Only if the row still holds what was read (an edit in the app meanwhile wins).
        // (Every $n must appear in the SQL, so the list is built to match.)
        const params = [row.id, row.value];
        const sets = [];
        if (encrypting) sets.push(`${column} = ${write(`$${params.push(encrypted)}`)}`);
        if (hashColumn && hash && !row.hash) sets.push(`${hashColumn} = $${params.push(hash)}`);
        const changed = await client.query(
          `update public.${table} set ${sets.join(", ")} where id::text = $1 and ${value} is not distinct from $2::text`,
          params,
        );
        if (changed.rowCount !== 1) stats.changedMeanwhile += 1;
      }

      await client.query(dryRun ? "rollback" : "commit");
      lastId = rows[rows.length - 1].id;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  }
  return stats;
}

/** Every encrypted value must decrypt, and (unless hash-only) no plain text may remain. */
async function verifyColumn(client, spec, { hashOnly }) {
  const table = ident(spec.table);
  const { value, present } = sqlFor(spec);
  const { rows } = await client.query(
    `select id::text as id, ${value} as value${spec.hash ? `, ${ident(spec.hash.column)} as hash` : ""}
       from public.${table} where ${present}`,
  );
  let encrypted = 0;
  let plain = 0;
  let badHash = 0;
  for (const row of rows) {
    if (isEncrypted(row.value)) encrypted += 1;
    else plain += 1;
    const decrypted = decryptField(row.value); // throws on a damaged value
    if (spec.hash && row.hash !== hashOf(spec, decrypted)) badHash += 1;
  }
  const problems = [];
  if (!hashOnly && plain) problems.push(`${plain} still plain text`);
  if (badHash) problems.push(`${badHash} missing/wrong ${spec.hash.column}`);
  return { encrypted, plain, badHash, problems };
}

run(async () => {
  const phase = process.argv[2];
  const specs = PHASES[phase];
  if (!specs) throw new Error("Usage: node azure/encrypt-columns.mjs <1|2|3> [--dry-run | --hash-only | --verify-only]");
  const dryRun = flag("--dry-run");
  const hashOnly = flag("--hash-only");
  const verifyOnly = flag("--verify-only");
  const batchSize = Number(option("--batch", "500"));
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) throw new Error("--batch must be 1-5000.");

  loadEnv();
  const keyring = await loadKeyring(process.env);
  if (!keyring) throw new Error("No encryption keys configured (KEY_VAULT_URL).");

  const { client, database, label } = await connect();
  try {
    console.log(`Database: ${label}`);
    console.log(`Keys:     ${process.env.KEY_VAULT_URL?.trim() || "environment (development keys)"}, current key "${keyring.currentKeyId}"`);
    await verifyKeyFingerprints(keyring, (sql, params) => client.query(sql, params));
    setKeyring(keyring);

    let active = hashOnly ? specs.filter((spec) => spec.hash) : specs;
    const badColumns = await columnProblems(client, active);
    const blockers = [...badColumns.values()];
    if (!verifyOnly) {
      const triggers = await triggerProblem(client, active.filter((spec) => !badColumns.has(spec)), hashOnly);
      if (triggers) blockers.push(triggers);
    }
    if (blockers.length) {
      if (!dryRun) throw new Error(`Cannot run phase ${phase}:\n- ${blockers.join("\n- ")}`);
      console.log(`\nA real run would refuse to start:\n- ${blockers.join("\n- ")}`);
      active = active.filter((spec) => !badColumns.has(spec));
    }

    if (!verifyOnly) {
      if (!dryRun) {
        if (flag("--skip-backup-check")) console.log("Backup check skipped (--skip-backup-check).");
        else await checkRecentBackup(Number(option("--max-backup-age-hours", "6")));
        const mode = hashOnly ? "fill the lookup hashes of" : "ENCRYPT";
        await confirmDatabase(database, `\nAbout to ${mode} phase ${phase} (${active.map(fieldOf).join(", ")}) in ${label}.`);
      }

      console.log(dryRun ? "\nDry run: nothing will be saved." : "");
      for (const spec of active) {
        const stats = await processColumn(client, spec, { hashOnly, dryRun, batchSize });
        const parts = [`${stats.encrypted} to encrypt`];
        if (spec.hash) parts.push(`${stats.hashed} hashes to fill`, `${stats.noHash} without a usable ${spec.hash.kind}`);
        if (stats.changedMeanwhile) parts.push(`${stats.changedMeanwhile} skipped (changed while running; run again)`);
        console.log(`  ${fieldOf(spec).padEnd(40)} ${parts.join(", ")}${dryRun ? "" : " - done"}`);
      }
    }

    if (dryRun) return;
    console.log("\nVerifying (every value is decrypted once):");
    let failed = false;
    for (const spec of active) {
      const result = await verifyColumn(client, spec, { hashOnly });
      failed ||= result.problems.length > 0;
      console.log(
        `  ${fieldOf(spec).padEnd(40)} ${result.encrypted} encrypted, ${result.plain} plain` +
          (result.problems.length ? `  PROBLEM: ${result.problems.join("; ")}` : "  OK"),
      );
    }
    if (failed) throw new Error("Verification found problems (see above).");
    console.log("All checks passed.");
  } finally {
    await client.end();
  }
});
