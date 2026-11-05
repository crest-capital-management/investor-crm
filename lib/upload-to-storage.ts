/**
 * Sends a file from the browser straight to Azure Blob Storage, using the
 * short-lived upload link the server prepared (createMediaUploadTarget /
 * createPortfolioUploadTarget). Returns false if storage refused it.
 */
export async function uploadToSignedUrl(uploadUrl: string, file: File): Promise<boolean> {
  try {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    return res.ok;
  } catch {
    return false;
  }
}
