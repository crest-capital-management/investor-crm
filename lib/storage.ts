import {
  BlobSASPermissions,
  BlobServiceClient,
  SASProtocol,
  type ContainerClient,
} from "@azure/storage-blob";

/**
 * File storage on Azure Blob Storage. Every container is private: files are
 * only reachable through short-lived signed links (SAS) that the signed-in CRM
 * hands out, never by a guessable public address.
 */
export const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";
export const PORTFOLIO_BUCKET = "portfolio-updates";
export const BACKUP_BUCKET = "backups";

/** What a WhatsApp message records in media_url for a file we store. */
const MEDIA_REF_PREFIX = `azure-blob://${WHATSAPP_MEDIA_BUCKET}/`;
/** Files stored before the move to Azure keep their old Supabase address; the path is the same. */
const LEGACY_SUPABASE_MARKER = "/storage/v1/object/";

let service: BlobServiceClient | null = null;

function container(name: string): ContainerClient {
  if (!service) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not configured.");
    service = BlobServiceClient.fromConnectionString(connectionString);
  }
  return service.getContainerClient(name);
}

function signedUrl(
  bucket: string,
  path: string,
  permissions: string,
  seconds: number,
  extra: { contentDisposition?: string } = {},
): Promise<string> {
  const now = Date.now();
  return container(bucket).getBlockBlobClient(path).generateSasUrl({
    permissions: BlobSASPermissions.parse(permissions),
    // A few minutes' leeway for clocks that are slightly off.
    startsOn: new Date(now - 5 * 60 * 1000),
    expiresOn: new Date(now + seconds * 1000),
    // Https only, except for the local storage emulator (Azurite), which serves plain http.
    protocol: service?.url.startsWith("https:") ? SASProtocol.Https : SASProtocol.HttpsAndHttp,
    ...extra,
  });
}

function attachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function newUploadPath(contactId: string, filename: string): string {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${contactId}/${Date.now()}-${safeFilename}`;
}

/**
 * The storage path inside the whatsapp-media container for a stored file's
 * media_url, or null if it isn't one of our stored files.
 */
export function mediaStoragePathFromUrl(mediaUrl: string): string | null {
  let encoded: string | null = null;
  if (mediaUrl.startsWith(MEDIA_REF_PREFIX)) {
    encoded = mediaUrl.slice(MEDIA_REF_PREFIX.length);
  } else {
    const at = mediaUrl.indexOf(LEGACY_SUPABASE_MARKER);
    if (at === -1) return null;
    const rest = mediaUrl.slice(at + LEGACY_SUPABASE_MARKER.length).split("?")[0]; // public/<bucket>/<path>
    const match = rest.match(/^(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!match || match[1] !== WHATSAPP_MEDIA_BUCKET) return null;
    encoded = match[2];
  }
  try {
    return decodeURIComponent(encoded) || null;
  } catch {
    return null;
  }
}

/** A short-lived link to a stored WhatsApp file. */
export async function createSignedMediaUrl(path: string, seconds = 3600): Promise<string | null> {
  try {
    return await signedUrl(WHATSAPP_MEDIA_BUCKET, path, "r", seconds);
  } catch {
    return null;
  }
}

/** The address recorded on a message for a file in the container (kept in this form for all stored files). */
export function mediaUrlForPath(path: string): string {
  return MEDIA_REF_PREFIX + path.split("/").map(encodeURIComponent).join("/");
}

export type UploadTarget = { path: string; uploadUrl: string };

/**
 * Lets the browser upload a file straight to storage, so a big attachment
 * doesn't have to pass through the web server. The link can only create or
 * write that one file and expires after 15 minutes.
 */
export async function createMediaUploadTarget(contactId: string, filename: string): Promise<UploadTarget> {
  const path = newUploadPath(contactId, filename);
  try {
    return { path, uploadUrl: await signedUrl(WHATSAPP_MEDIA_BUCKET, path, "cw", 15 * 60) };
  } catch (err) {
    throw new Error(`Could not prepare the upload: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

/** Saves a file received from WhatsApp, replacing any earlier copy, and returns its media_url. */
export async function saveInboundMedia(path: string, body: Buffer, contentType: string): Promise<string> {
  try {
    await container(WHATSAPP_MEDIA_BUCKET)
      .getBlockBlobClient(path)
      .uploadData(body, { blobHTTPHeaders: { blobContentType: contentType } });
  } catch (err) {
    throw new Error(`Failed to store media file: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  return mediaUrlForPath(path);
}

/** Downloads a stored file's bytes (server to storage; not limited by the web request size). */
export async function downloadStoredMedia(path: string): Promise<Buffer> {
  try {
    return await container(WHATSAPP_MEDIA_BUCKET).getBlockBlobClient(path).downloadToBuffer();
  } catch (err) {
    throw new Error(`Could not read the uploaded file: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

/** Same as createMediaUploadTarget, for the portfolio-updates container. */
export async function createPortfolioUploadTarget(contactId: string, filename: string): Promise<UploadTarget> {
  const path = newUploadPath(contactId, filename);
  try {
    return { path, uploadUrl: await signedUrl(PORTFOLIO_BUCKET, path, "cw", 15 * 60) };
  } catch (err) {
    throw new Error(`Could not prepare the upload: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

/** Saves bytes (e.g. pasted text) straight into the portfolio-updates container. Never overwrites. */
export async function uploadPortfolioFile(path: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await container(PORTFOLIO_BUCKET)
      .getBlockBlobClient(path)
      .uploadData(body, { blobHTTPHeaders: { blobContentType: contentType }, conditions: { ifNoneMatch: "*" } });
  } catch (err) {
    throw new Error(`Could not save the update: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

export async function downloadPortfolioFile(path: string): Promise<Buffer> {
  try {
    return await container(PORTFOLIO_BUCKET).getBlockBlobClient(path).downloadToBuffer();
  } catch (err) {
    throw new Error(`Could not read the uploaded file: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

/** A short-lived download link; the file name is used as the saved name. */
export async function createSignedPortfolioUrl(path: string, downloadName?: string, seconds = 300): Promise<string | null> {
  try {
    return await signedUrl(PORTFOLIO_BUCKET, path, "r", seconds, downloadName ? { contentDisposition: attachment(downloadName) } : {});
  } catch {
    return null;
  }
}

export async function removePortfolioFile(path: string): Promise<void> {
  await container(PORTFOLIO_BUCKET).getBlockBlobClient(path).deleteIfExists();
}

export type StoredFile = { name: string; bytes: number };

/** Saves (or replaces) one backup file in the private backups container, creating it on first use. */
export async function saveBackupFile(name: string, body: Buffer): Promise<void> {
  const backups = container(BACKUP_BUCKET);
  await backups.createIfNotExists();
  await backups.getBlockBlobClient(name).uploadData(body, { blobHTTPHeaders: { blobContentType: "application/gzip" } });
}

/** Every file in the backups container (empty if it doesn't exist yet). */
export async function listBackupFiles(): Promise<StoredFile[]> {
  const backups = container(BACKUP_BUCKET);
  if (!(await backups.exists())) return [];
  const files: StoredFile[] = [];
  for await (const blob of backups.listBlobsFlat()) {
    files.push({ name: blob.name, bytes: Number(blob.properties.contentLength ?? 0) });
  }
  return files;
}

export async function removeBackupFiles(names: string[]): Promise<void> {
  const backups = container(BACKUP_BUCKET);
  await Promise.all(names.map((name) => backups.getBlockBlobClient(name).deleteIfExists()));
}

/** A download link for one backup. */
export function createBackupDownloadUrl(name: string, seconds = 60): Promise<string> {
  return signedUrl(BACKUP_BUCKET, name, "r", seconds, { contentDisposition: attachment(name) });
}
