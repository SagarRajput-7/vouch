import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { unauthorized } from "@/lib/api/errors";
import { ensureDbReady } from "@/lib/db/client";
import { workspacesRepo } from "@/lib/repo/workspaces";

export type SessionInfo = {
  userId: string;
  sessionId: string;
  isAnonymous: boolean;
  workspaceId: string;
};

export async function sessionFromHeaders(h: Headers): Promise<SessionInfo | null> {
  await ensureDbReady();
  const result = await auth.api.getSession({ headers: h });
  if (!result) return null;
  const isAnonymous = Boolean((result.user as { isAnonymous?: boolean }).isAnonymous);
  const ws = await workspacesRepo.findOrCreateForUser(result.user.id, isAnonymous);
  return { userId: result.user.id, sessionId: result.session.id, isAnonymous, workspaceId: ws.id };
}

export async function getSession(): Promise<SessionInfo | null> {
  return sessionFromHeaders(await headers());
}

export async function requireSession(): Promise<SessionInfo> {
  const info = await getSession();
  if (!info) throw unauthorized();
  return info;
}

export async function requireSessionFor(request: Request): Promise<SessionInfo> {
  const info = await sessionFromHeaders(request.headers);
  if (!info) throw unauthorized();
  return info;
}

/** Creates an anonymous user and session. Returns the Set-Cookie headers to forward. */
export async function startGuestSession(): Promise<{ headers: Headers; info: SessionInfo }> {
  await ensureDbReady();
  const { headers: setCookie, response } = await auth.api.signInAnonymous({ returnHeaders: true });
  if (!response?.user) throw new Error("Anonymous sign-in returned no user");
  const ws = await workspacesRepo.findOrCreateForUser(response.user.id, true);
  const cookie = setCookie
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("Anonymous session could not be read back");
  return {
    headers: setCookie,
    info: {
      userId: response.user.id,
      sessionId: session.session.id,
      isAnonymous: true,
      workspaceId: ws.id,
    },
  };
}
