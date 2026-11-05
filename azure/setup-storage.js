// Checks the Azure Storage account for the CRM (Phase 3). Safe to run again.
//   node azure/setup-storage.js
// - creates any of the three containers (whatsapp-media, portfolio-updates, backups) that is missing, as private;
// - fails if any of them allows public access.
// No CORS rule is needed: the browser uploads to the CRM's own /api/uploads route,
// and only the CRM server talks to storage.
// Reads AZURE_STORAGE_CONNECTION_STRING from .env.local and prints no secrets.
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const { BlobServiceClient } = require(path.join(root, 'node_modules/@azure/storage-blob'));

const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^['"]|['"]$/g, '')]));
const CONTAINERS = ['whatsapp-media', 'portfolio-updates', 'backups'];

(async () => {
  if (!env.AZURE_STORAGE_CONNECTION_STRING) throw new Error('AZURE_STORAGE_CONNECTION_STRING is missing from .env.local.');
  const service = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING);
  console.log('Storage account:', service.accountName);

  for (const name of CONTAINERS) {
    const container = service.getContainerClient(name);
    const created = (await container.createIfNotExists()).succeeded; // no access option = private
    const access = (await container.getAccessPolicy()).blobPublicAccess;
    if (access) throw new Error(`Container "${name}" allows public access (${access}). Make it private first.`);
    console.log(`container ${name.padEnd(18)} ${created ? 'created' : 'already there'}, private`);
  }
})().catch(e => {
  console.log('Setup failed:', e.message);
  process.exitCode = 1;
});
