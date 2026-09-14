import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auth } from "@/lib/auth/server";
import { startGuestSession, sessionFromHeaders } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { documents, workspaces } from "@/lib/db/schema";
import { workspacesRepo } from "@/lib/repo/workspaces";

function seedDocument(workspaceId: string, sha256: string) {
  return getDb()
    .insert(documents)
    .values({
      workspaceId,
      sha256,
      originalFilename: "invoice.pdf",
      mime: "application/pdf",
      byteSize: 1024,
      blobKey: `blobs/${workspaceId}/${sha256}`,
    })
    .returning();
}

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
  it("reassigns the workspace when the new owner has none yet", async () => {
    const a = await startGuestSession();
    // A real user row with no workspace yet: sign in anonymously directly, bypassing
    // startGuestSession's own findOrCreateForUser call so no workspace exists for it.
    const { response } = await auth.api.signInAnonymous({ returnHeaders: true });
    if (!response?.user) throw new Error("expected an anonymous user");
    const freshUserId = response.user.id;

    const result = await workspacesRepo.promoteToAccount(a.info.workspaceId, freshUserId);
    expect(result).toEqual({ mode: "reassigned", workspaceId: a.info.workspaceId });

    const promoted = await workspacesRepo.getById(a.info.workspaceId);
    expect(promoted?.ownerUserId).toBe(freshUserId);
    expect(promoted?.kind).toBe("account");
    expect(promoted?.expiresAt).toBeNull();
  });

  it("merges into the new owner's existing workspace, keeping both documents", async () => {
    const source = await startGuestSession();
    const target = await startGuestSession();
    await seedDocument(source.info.workspaceId, "sha-source-only");
    await seedDocument(target.info.workspaceId, "sha-target-only");

    const result = await workspacesRepo.promoteToAccount(
      source.info.workspaceId,
      target.info.userId,
    );
    expect(result).toEqual({ mode: "merged", workspaceId: target.info.workspaceId });

    const targetWorkspace = await workspacesRepo.getById(target.info.workspaceId);
    expect(targetWorkspace?.ownerUserId).toBe(target.info.userId);
    expect(targetWorkspace?.deletedAt).toBeNull();

    const movedDocs = await getDb().query.documents.findMany({
      where: eq(documents.workspaceId, target.info.workspaceId),
    });
    expect(movedDocs.map((d) => d.sha256).sort()).toEqual(["sha-source-only", "sha-target-only"]);

    // getById filters out deleted rows, so query the source workspace directly.
    const sourceWorkspaceRow = await getDb().query.workspaces.findFirst({
      where: eq(workspaces.id, source.info.workspaceId),
    });
    expect(sourceWorkspaceRow?.deletedAt).not.toBeNull();
  });

  it("drops the source's duplicate document and keeps the target's copy on merge", async () => {
    const source = await startGuestSession();
    const target = await startGuestSession();
    await seedDocument(source.info.workspaceId, "sha-shared");
    const [targetDoc] = await seedDocument(target.info.workspaceId, "sha-shared");

    await workspacesRepo.promoteToAccount(source.info.workspaceId, target.info.userId);

    const sharedDocs = await getDb().query.documents.findMany({
      where: eq(documents.sha256, "sha-shared"),
    });
    expect(sharedDocs.length).toBe(1);
    expect(sharedDocs[0]?.workspaceId).toBe(target.info.workspaceId);
    expect(sharedDocs[0]?.id).toBe(targetDoc.id);
  });
});
