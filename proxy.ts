import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // getToken checks the signed session cookie locally (no database or network call).
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  // Anyone with a valid signed session (an account in crm_users) counts as signed in.
  const user = token?.sub ? token : null;
  const pathname = request.nextUrl.pathname;
  const isProtectedRoute =
    pathname === "/" ||
    /^(?:\/dashboard|\/contacts|\/groups|\/investors|\/follow-ups|\/my-profile|\/broadcasts|\/templates|\/unread-messages)(?:\/|$)/.test(pathname);

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
    "/follow-ups/:path*",
    "/investors/:path*",
    "/my-profile/:path*",
    "/broadcasts/:path*",
    "/templates/:path*",
    "/unread-messages/:path*",
  ],
};
