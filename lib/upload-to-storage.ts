/**
 * Sends a file from the browser to the CRM's /api/uploads route, which saves
 * it to storage. The address comes from the server's upload step
 * (createMediaUploadTarget / createPortfolioUploadTarget). Returns false if the
 * upload was refused or failed.
 */
export async function uploadFile(uploadUrl: string, file: File): Promise<boolean> {
  try {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    return res.ok;
  } catch {
    return false;
  }
}
