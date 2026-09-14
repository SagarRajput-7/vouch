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

export const config = {
  matcher: ["/", "/documents/:path*", "/invoices", "/how-it-works"],
};
