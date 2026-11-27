import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy, createNonce, cspHeaderName, storageOrigin } from "@/lib/csp";

const PROTECTED_ROUTE =
  /^(?:\/dashboard|\/contacts|\/groups|\/investors|\/follow-ups|\/my-profile|\/broadcasts|\/templates|\/unread-messages)(?:\/|$)/;

export async function proxy(request: NextRequest) {
  // getToken checks the signed session cookie locally (no database or network call).
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  // Anyone with a valid signed session (an account in crm_users) counts as signed in.
  const user = token?.sub ? token : null;
  const pathname = request.nextUrl.pathname;
  const isProtectedRoute = pathname === "/" || PROTECTED_ROUTE.test(pathname);

  if (!user && isProtectedRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && pathname === "/login") {
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
  return response;
}

export const config = {
  matcher: [
    // Every page. Not API routes (JSON, their own auth checks), Next.js build
    // files, or files from public/ (anything with a file extension).
    "/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.[A-Za-z0-9]+$).*)",
  ],
};
