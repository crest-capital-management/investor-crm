import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy, createNonce, cspHeaderName, storageOrigin } from "@/lib/csp";
import { isSessionCurrent } from "@/lib/session";

const PROTECTED_ROUTE =
  /^(?:\/dashboard|\/contacts|\/groups|\/investors|\/follow-ups|\/my-profile|\/broadcasts|\/templates|\/unread-messages)(?:\/|$)/;

/**
 * API routes anyone may call: they check their own credentials instead of a
 * session (NextAuth itself; the WhatsApp webhook signs each request with the
 * Meta app secret; the scheduled jobs send SCHEDULER_SECRET). Every other API
 * route needs a current session here, and checks it again itself.
 */
const PUBLIC_API = /^\/api\/(?:auth\/|whatsapp\/webhook$|(?:backup|broadcasts|follow-ups)\/trigger$)/;

const SESSION_COOKIES = ["next-auth.session-token", "__Secure-next-auth.session-token"];

/** Removes the session cookie (also NextAuth's split ".0", ".1" parts) from the browser. */
function clearSession(request: NextRequest, response: NextResponse): NextResponse {
  for (const { name } of request.cookies.getAll()) {
    if (SESSION_COOKIES.some((base) => name === base || name.startsWith(`${base}.`))) response.cookies.delete(name);
  }
  return response;
}

export async function proxy(request: NextRequest) {
  // getToken checks the signed session cookie locally; isSessionCurrent then
  // makes sure the account still exists and its password hasn't changed since
  // (lib/session.ts, one cached database lookup).
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const signedIn = Boolean(token?.sub) && (await isSessionCurrent(token?.sub, token?.pv, token?.amr));
  // A valid cookie whose session has ended (password changed, account removed,
  // signed in without the emailed code, or from before these checks).
  const ended = Boolean(token?.sub) && !signedIn;
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api/")) {
    if (!signedIn && !PUBLIC_API.test(pathname)) {
      const denied = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      return ended ? clearSession(request, denied) : denied;
    }
    return NextResponse.next();
  }

  const isProtectedRoute = pathname === "/" || PROTECTED_ROUTE.test(pathname);
  if (!signedIn && isProtectedRoute) {
    const toLogin = NextResponse.redirect(new URL("/login", request.url));
    return ended ? clearSession(request, toLogin) : toLogin;
  }

  if (signedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Content-Security-Policy with a fresh nonce (lib/csp.ts). Next.js reads the
  // nonce from the request's copy of the header and stamps it on its scripts;
  // app/layout.tsx reads x-nonce for the theme script.
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    storageOrigin: storageOrigin(process.env.AZURE_STORAGE_CONNECTION_STRING),
  });
  const headerName = cspHeaderName();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(headerName, policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(headerName, policy);
  return ended ? clearSession(request, response) : response;
}

export const config = {
  matcher: [
    // Every page and API route. Not Next.js build files or files from public/
    // (anything with a file extension).
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.[A-Za-z0-9]+$).*)",
  ],
};
