import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const cookie = getSessionCookie(request, { cookiePrefix: "vouch" });
  if (cookie) return NextResponse.next();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  const start = new URL("/api/session/start", request.url);
  start.searchParams.set("next", next);
  return NextResponse.redirect(start);
}

// Narrowed to the routes that actually exist. /invoices, /how-it-works and /documents/:path*
// are deferred to later plans; widen this again once they ship, so a guest hitting one of
// them gets a session redirect instead of matching nothing and falling straight to a 404.
export const config = {
  matcher: ["/"],
};
