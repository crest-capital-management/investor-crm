import type { Readable } from "node:stream";
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
export type UploadBucket = typeof WHATSAPP_MEDIA_BUCKET | typeof PORTFOLIO_BUCKET;

/** Largest file the CRM accepts per container (Meta's 16 MB media limit; 15 MB for portfolio files). */
export const MAX_UPLOAD_BYTES: Record<UploadBucket, number> = {
  [WHATSAPP_MEDIA_BUCKET]: 16 * 1024 * 1024,
  [PORTFOLIO_BUCKET]: 15 * 1024 * 1024,
};
/** An upload address from createMediaUploadTarget / createPortfolioUploadTarget stays usable this long. */
export const UPLOAD_WINDOW_MS = 15 * 60 * 1000;

// <contact uuid>/<13-digit time>-<safe name>, as newUploadPath makes it.
const UPLOAD_PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(\d{13})-[a-zA-Z0-9._-]{1,200}$/i;

/** True if the path is one newUploadPath made in the last UPLOAD_WINDOW_MS. */
export function isFreshUploadPath(path: string): boolean {
  const match = path.match(UPLOAD_PATH);
  if (!match) return false;
  const age = Date.now() - Number(match[2]);
  return age >= -60 * 1000 && age <= UPLOAD_WINDOW_MS;
}

function uploadAddress(bucket: UploadBucket, path: string): string {
  return `/api/uploads?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
}

/**
 * Reserves a place for a file the browser is about to upload. The browser sends
 * the file to the CRM's own /api/uploads route (signed-in owner only), which
 * writes it to storage; storage itself is never opened to the browser.
 */
export async function createMediaUploadTarget(contactId: string, filename: string): Promise<UploadTarget> {
  const path = newUploadPath(contactId, filename);
  return { path, uploadUrl: uploadAddress(WHATSAPP_MEDIA_BUCKET, path) };
}

/** Writes an uploaded file from the browser (a stream) to storage. Never overwrites an existing file. */
export async function saveUploadedFile(
  bucket: UploadBucket,
  path: string,
  body: Readable,
  contentType: string,
): Promise<void> {
  await container(bucket)
    .getBlockBlobClient(path)
    .uploadStream(body, 4 * 1024 * 1024, 4, {
      blobHTTPHeaders: { blobContentType: contentType },
      conditions: { ifNoneMatch: "*" },
    });
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
  return { path, uploadUrl: uploadAddress(PORTFOLIO_BUCKET, path) };
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

/** Reads one backup file's bytes (for a restore). */
export async function downloadBackupFile(name: string): Promise<Buffer> {
  try {
    return await container(BACKUP_BUCKET).getBlockBlobClient(name).downloadToBuffer();
  } catch (err) {
    throw new Error(`Could not read the backup file: ${err instanceof Error ? err.message : "unknown error"}`);
  }
}

/** Writes a backup file uploaded from the browser (a stream) into the backups container. Never overwrites. */
export async function saveUploadedBackupFile(name: string, body: Readable): Promise<void> {
  const backups = container(BACKUP_BUCKET);
  await backups.createIfNotExists();
  await backups.getBlockBlobClient(name).uploadStream(body, 4 * 1024 * 1024, 4, {
    blobHTTPHeaders: { blobContentType: "application/gzip" },
    conditions: { ifNoneMatch: "*" },
  });
}

/** A download link for one backup. */
export function createBackupDownloadUrl(name: string, seconds = 60): Promise<string> {
  return signedUrl(BACKUP_BUCKET, name, "r", seconds, { contentDisposition: attachment(name) });
}
