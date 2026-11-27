/**
 * Content-Security-Policy for every page (TSK-38 package 6).
 *
 * proxy.ts makes a fresh random nonce per request and sends this policy;
 * Next.js reads the nonce from the request's policy header and stamps it on
 * its own scripts and inline styles, and app/layout.tsx puts it on the
 * theme script. Any other script (an injected <script>, an inline onclick=,
 * a script from another site) is refused by the browser.
 *
 * What the pages need, and why each source is allowed:
 *   script-src  only nonced scripts ('strict-dynamic' lets them load the
 *               app's own chunks); 'unsafe-eval' in development only (React's
 *               dev tools need it, production doesn't).
 *   style-src   the app's stylesheets and nonced <style>; style="" attributes
 *               (React and the UI library set them) via style-src-attr.
 *               In development 'unsafe-inline' instead of the nonce (Next.js's
 *               dev overlay adds unnonced <style> tags), as the Next.js guide says.
 *   img-src /   chat photos, voice notes and videos: /api/whatsapp/media/...
 *   media-src   redirects to a short-lived link on the Azure storage account,
 *               so that one storage origin is allowed; data:/blob: for
 *               previews.
 *   connect-src the app's own API only (the browser calls no other site).
 *   frame-ancestors 'none' (no framing, like X-Frame-Options), object-src
 *               'none', base-uri and form-action 'self'.
 *
 * CSP_REPORT_ONLY=1 in the server .env sends the same policy as
 * Content-Security-Policy-Report-Only: the browser only reports breaches in
 * its console and blocks nothing. A fallback if something breaks after
 * go-live (change .env, restart; no redeploy).
 */

export function cspHeaderName(env: Record<string, string | undefined> = process.env): string {
  return env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

/**
 * The https origin of the Azure storage account in AZURE_STORAGE_CONNECTION_STRING
 * (BlobEndpoint=..., or DefaultEndpointsProtocol + AccountName + EndpointSuffix),
 * or null if it can't be read.
 */
export function storageOrigin(connectionString: string | undefined): string | null {
  if (!connectionString) return null;
  const parts = new Map<string, string>();
  for (const part of connectionString.split(";")) {
    const at = part.indexOf("=");
    if (at > 0) parts.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
  }
  try {
    const endpoint = parts.get("blobendpoint");
    if (endpoint) return new URL(endpoint).origin;
    const account = parts.get("accountname");
    if (!account || !/^[a-z0-9]{3,24}$/.test(account)) return null;
    const protocol = parts.get("defaultendpointsprotocol") === "http" ? "http" : "https";
    const suffix = parts.get("endpointsuffix") || "core.windows.net";
    return new URL(`${protocol}://${account}.blob.${suffix}`).origin;
  } catch {
    return null;
  }
}

/** A fresh nonce for one response (128 random bits, base64). */
export function createNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

export function buildContentSecurityPolicy(options: { nonce: string; isDev: boolean; storageOrigin: string | null }): string {
  const { nonce, isDev } = options;
  const storage = options.storageOrigin ? ` ${options.storageOrigin}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Development: Next.js's error overlay and live reload add <style> tags without the nonce.
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob:${storage}`,
    `media-src 'self' blob:${storage}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
