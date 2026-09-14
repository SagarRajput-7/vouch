import { NextResponse } from "next/server";
import { getSession, startGuestSession } from "@/lib/auth/session";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next"));
  const existing = await getSession();
  if (existing) return NextResponse.redirect(new URL(next, url.origin));

  const { headers } = await startGuestSession();
  const res = NextResponse.redirect(new URL(next, url.origin));
  for (const cookie of headers.getSetCookie()) res.headers.append("set-cookie", cookie);
  return res;
}
