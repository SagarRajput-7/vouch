import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { workspaces } from "@/lib/db/schema";

const GUEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type Workspace = typeof workspaces.$inferSelect;

export const workspacesRepo = {
  /**
   * Idempotent per user: `workspaces_owner_active_idx` is a unique index on
   * ownerUserId partial to `deleted_at is null`, so concurrent callers race
   * on a single insert instead of a racy find-then-insert. The loser of the
   * race gets no row back from `onConflictDoNothing` and re-reads the
   * winner's row instead.
   */
  async findOrCreateForUser(userId: string, isAnonymous: boolean): Promise<Workspace> {
    const db = getDb();
    const [created] = await db
      .insert(workspaces)
      .values({
        ownerUserId: userId,
        kind: isAnonymous ? "guest" : "account",
        expiresAt: isAnonymous ? new Date(Date.now() + GUEST_LIFETIME_MS) : null,
      })
      .onConflictDoNothing({ target: workspaces.ownerUserId, where: sql`deleted_at is null` })
      .returning();
    if (created) return created;
    const existing = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.ownerUserId, userId), isNull(workspaces.deletedAt)),
    });
    if (!existing) {
      throw new Error(
        `Workspace insert conflicted for user ${userId} but no active workspace was found`,
      );
    }
    return existing;
  },

  async getById(id: string): Promise<Workspace | null> {
    const db = getDb();
    const row = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, id), isNull(workspaces.deletedAt)),
    });
    return row ?? null;
  },

  /**
   * `workspaces_owner_active_idx` allows only one active workspace per
   * owner, so reassigning ownership to a user who already has one (a
   * second device linking the same account, for example) would otherwise
   * violate that constraint. Soft-deleting the target's other active
   * workspace first, in the same transaction, keeps the invariant and
   * makes the just-promoted workspace the sole survivor.
   */
  async promoteToAccount(workspaceId: string, newOwnerUserId: string): Promise<void> {
    await getDb().transaction(async (tx) => {
      await tx
        .update(workspaces)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(workspaces.ownerUserId, newOwnerUserId),
            isNull(workspaces.deletedAt),
            ne(workspaces.id, workspaceId),
          ),
        );
      await tx
        .update(workspaces)
        .set({
          ownerUserId: newOwnerUserId,
          kind: "account",
          expiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(workspaces.id, workspaceId));
    });
  },

  async deleteCascade(id: string): Promise<void> {
    await getDb().delete(workspaces).where(eq(workspaces.id, id));
  },
};
