import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/server";
import { startGuestSession, sessionFromHeaders } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";
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

  it("stays idempotent under concurrent calls for the same user", async () => {
    const { info } = await startGuestSession();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => workspacesRepo.findOrCreateForUser(info.userId, true)),
    );
    const ids = new Set(results.map((ws) => ws.id));
    expect(ids.size).toBe(1);
    expect(results.every((ws) => ws.id === info.workspaceId)).toBe(true);

    const active = await getDb().query.workspaces.findMany({
      where: and(eq(workspaces.ownerUserId, info.userId), isNull(workspaces.deletedAt)),
    });
    expect(active.length).toBe(1);
  });

  it("exposes the session endpoints", async () => {
    expect(typeof auth.api.getSession).toBe("function");
    expect(typeof auth.api.signInAnonymous).toBe("function");
  });
});

describe("workspace promotion", () => {
  it("promotes a workspace to an account, changing owner, kind, and clearing expiry", async () => {
    const a = await startGuestSession();
    const b = await startGuestSession();

    await workspacesRepo.promoteToAccount(a.info.workspaceId, b.info.userId);

    const promoted = await workspacesRepo.getById(a.info.workspaceId);
    expect(promoted?.ownerUserId).toBe(b.info.userId);
    expect(promoted?.kind).toBe("account");
    expect(promoted?.expiresAt).toBeNull();

    // b already owned an active guest workspace before the promotion; the unique
    // partial index allows only one active workspace per owner, so promoting a's
    // workspace onto b's id must retire b's original one rather than conflict.
    expect(await workspacesRepo.getById(b.info.workspaceId)).toBeNull();
  });
});
