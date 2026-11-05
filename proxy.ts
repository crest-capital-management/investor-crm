import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // getToken checks the signed session cookie locally (no database or network call).
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  // Only the CRM owner counts as signed in. Anyone else is sent to /login, and /login
  // stays open to them (so a rejected account can't loop between the two).
  const ownerId = process.env.CRM_OWNER_ID?.trim().toLowerCase();
  const user = token?.sub && ownerId && token.sub.toLowerCase() === ownerId ? token : null;
  const pathname = request.nextUrl.pathname;
  const isProtectedRoute =
    pathname === "/" ||
    /^(?:\/dashboard|\/contacts|\/groups|\/investors|\/my-profile|\/broadcasts|\/templates|\/unread-messages)(?:\/|$)/.test(pathname);

  if (!user && isProtectedRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/dashboard/:path*",
    "/contacts/:path*",
    "/groups/:path*",
    "/investors/:path*",
    "/my-profile/:path*",
    "/broadcasts/:path*",
    "/templates/:path*",
    "/unread-messages/:path*",
  ],
};
