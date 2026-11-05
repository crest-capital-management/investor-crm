// One-time setup of the Azure Storage account for the CRM (Phase 3). Safe to run again.
//   node azure/setup-storage.js https://investor-crm.crest-capital.com http://localhost:3000
// - creates the three private containers (whatsapp-media, portfolio-updates, backups);
// - refuses to continue if any of them allows public access;
// - adds a CORS rule so the browser can upload straight to storage (PUT with a
//   signed link) from the site addresses given as arguments. Other CORS rules are kept.
// Reads AZURE_STORAGE_CONNECTION_STRING from .env.local and prints no secrets.
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const { BlobServiceClient } = require(path.join(root, 'node_modules/@azure/storage-blob'));

const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .map(l => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim().replace(/^['"]|['"]$/g, '')]));
const CONTAINERS = ['whatsapp-media', 'portfolio-updates', 'backups'];
const origins = process.argv.slice(2).map(o => o.replace(/\/+$/, ''));

(async () => {
  if (!env.AZURE_STORAGE_CONNECTION_STRING) throw new Error('AZURE_STORAGE_CONNECTION_STRING is missing from .env.local.');
  if (!origins.length || origins.some(o => !/^https?:\/\/[^/]+$/.test(o))) {
    throw new Error('Give the site addresses, e.g. node azure/setup-storage.js https://investor-crm.crest-capital.com http://localhost:3000');
  }
  const service = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING);
  console.log('Storage account:', service.accountName);

  for (const name of CONTAINERS) {
    const container = service.getContainerClient(name);
    const created = (await container.createIfNotExists()).succeeded; // no access option = private
    const access = (await container.getAccessPolicy()).blobPublicAccess;
    if (access) throw new Error(`Container "${name}" allows public access (${access}). Make it private first.`);
    console.log(`container ${name.padEnd(18)} ${created ? 'created' : 'already there'}, private`);
  }

  const props = await service.getProperties();
  const ours = {
    allowedOrigins: origins.join(','),
    allowedMethods: 'PUT',
    allowedHeaders: 'content-type,x-ms-blob-type,x-ms-version,x-ms-client-request-id',
    exposedHeaders: 'etag,x-ms-request-id',
    maxAgeInSeconds: 3600,
  };
  const others = (props.cors ?? []).filter(rule => rule.allowedMethods !== 'PUT' || rule.allowedHeaders !== ours.allowedHeaders);
  await service.setProperties({ cors: [...others, ours] });
  console.log('CORS: browser uploads (PUT) allowed from', origins.join(', '));
})().catch(e => {
  console.log('Setup failed:', e.message);
  process.exitCode = 1;
});
