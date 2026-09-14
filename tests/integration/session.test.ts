import { describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/server";
import { startGuestSession, sessionFromHeaders } from "@/lib/auth/session";
import { workspacesRepo } from "@/lib/repo/workspaces";

function cookieHeader(from: Headers): Headers {
  const setCookie = from
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie: setCookie });
}

describe("guest sessions", () => {
  it("creates an anonymous user with a guest workspace that expires in seven days", async () => {
    const { headers, info } = await startGuestSession();
    expect(info.isAnonymous).toBe(true);
    const ws = await workspacesRepo.getById(info.workspaceId);
    expect(ws?.kind).toBe("guest");
    const days = (ws!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    const again = await sessionFromHeaders(cookieHeader(headers));
    expect(again?.userId).toBe(info.userId);
    expect(again?.workspaceId).toBe(info.workspaceId);
  });

  it("returns the same workspace for the same user", async () => {
    const { info } = await startGuestSession();
    const first = await workspacesRepo.findOrCreateForUser(info.userId, true);
    const second = await workspacesRepo.findOrCreateForUser(info.userId, true);
    expect(first.id).toBe(second.id);
  });

  it("exposes the session endpoints", async () => {
    expect(typeof auth.api.getSession).toBe("function");
    expect(typeof auth.api.signInAnonymous).toBe("function");
  });
});
