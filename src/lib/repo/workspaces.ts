import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";

const GUEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type Workspace = typeof workspaces.$inferSelect;

export const workspacesRepo = {
  async findOrCreateForUser(userId: string, isAnonymous: boolean): Promise<Workspace> {
    const db = getDb();
    const existing = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.ownerUserId, userId), isNull(workspaces.deletedAt)),
    });
    if (existing) return existing;
    const [created] = await db
      .insert(workspaces)
      .values({
        ownerUserId: userId,
        kind: isAnonymous ? "guest" : "account",
        expiresAt: isAnonymous ? new Date(Date.now() + GUEST_LIFETIME_MS) : null,
      })
      .returning();
    return created;
  },

  async getById(id: string): Promise<Workspace | null> {
    const db = getDb();
    const row = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, id), isNull(workspaces.deletedAt)),
    });
    return row ?? null;
  },

  async promoteToAccount(workspaceId: string, newOwnerUserId: string): Promise<void> {
    await getDb()
      .update(workspaces)
      .set({ ownerUserId: newOwnerUserId, kind: "account", expiresAt: null, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  },

  async deleteCascade(id: string): Promise<void> {
    await getDb().delete(workspaces).where(eq(workspaces.id, id));
  },
};
