// Copies every file from Supabase Storage into the Azure Storage account (Phase 3).
//   node azure/copy-files.js            copy (skips files already copied with the same MD5)
//   node azure/copy-files.js --check    only compare, copy nothing
// Buckets: whatsapp-media, portfolio-updates, backups. Paths stay the same, so the
// old Supabase addresses saved in whatsapp_messages.media_url still find their file
// (lib/storage.ts reads both forms). Supabase is only read, never changed.
// Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
// AZURE_STORAGE_CONNECTION_STRING from .env.local and prints no secrets.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
const { BlobServiceClient } = require(path.join(root, 'node_modules/@azure/storage-blob'));

const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^['"]|['"]$/g, '')]));
const BUCKETS = ['whatsapp-media', 'portfolio-updates', 'backups'];
const checkOnly = process.argv.includes('--check');

const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const auth = { Authorization: `Bearer ${key}`, apikey: key };
const encodePath = p => p.split('/').map(encodeURIComponent).join('/');

/** Every file in a bucket, walking into folders. */
async function listBucket(bucket, prefix = '') {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (res.status === 400 || res.status === 404) return files; // bucket does not exist
    if (!res.ok) throw new Error(`Listing ${bucket}/${prefix} failed: HTTP ${res.status}`);
    const items = await res.json();
    for (const item of items) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) files.push(...(await listBucket(bucket, full))); // a folder
      else files.push({ path: full, bytes: Number(item.metadata?.size ?? 0), type: item.metadata?.mimetype || 'application/octet-stream' });
    }
    if (items.length < 1000) return files;
  }
}

(async () => {
  if (!supabaseUrl || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from .env.local.');
  if (!env.AZURE_STORAGE_CONNECTION_STRING) throw new Error('AZURE_STORAGE_CONNECTION_STRING is missing from .env.local.');
  const service = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING);
  console.log(`${checkOnly ? 'Checking' : 'Copying'} Supabase Storage -> Azure account ${service.accountName}`);

  let problems = 0;
  for (const bucket of BUCKETS) {
    const container = service.getContainerClient(bucket);
    if (!(await container.exists())) throw new Error(`Container "${bucket}" does not exist. Run azure/setup-storage.js first.`);
    const files = await listBucket(bucket);
    let copied = 0, same = 0, missing = 0, bytes = 0;
    for (const file of files) {
      const blob = container.getBlockBlobClient(file.path);
      const res = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${encodePath(file.path)}`, { headers: auth });
      if (!res.ok) throw new Error(`Download of ${bucket}/${file.path} failed: HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      const md5 = crypto.createHash('md5').update(body).digest();
      const existing = await blob.getProperties().catch(() => null);
      if (existing?.contentMD5 && Buffer.from(existing.contentMD5).equals(md5)) { same++; continue; }
      if (checkOnly) { missing++; console.log(`  not copied yet / different: ${bucket}/${file.path}`); continue; }
      await blob.uploadData(body, { blobHTTPHeaders: { blobContentType: file.type, blobContentMD5: md5 } });
      const after = await blob.getProperties();
      if (!after.contentMD5 || !Buffer.from(after.contentMD5).equals(md5)) throw new Error(`MD5 mismatch after copying ${bucket}/${file.path}`);
      copied++; bytes += body.length;
    }
    problems += missing;
    console.log(`${bucket.padEnd(18)} files ${String(files.length).padStart(4)} | already identical ${same} | copied ${copied} (${(bytes / 1024).toFixed(0)} KB)${checkOnly ? ` | missing or different ${missing}` : ''}`);
  }
  console.log(problems ? `${problems} file(s) still to copy.` : 'All files are in Azure and identical (MD5).');
})().catch(e => {
  console.log('Failed:', e.message);
  process.exitCode = 1;
});
