import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLog, documents, invoices, jobs, usageLedger, workspaces } from "@/lib/db/schema";

const GUEST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type Workspace = typeof workspaces.$inferSelect;
export type PromoteResult =
  { mode: "reassigned"; workspaceId: string } | { mode: "merged"; workspaceId: string };

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
   * owner, so promoting a workspace to a user who already has one (a
   * returning user signing back in on a second device, for example) can
   * never simply reassign ownership: that would give the target two active
   * rows and violate the index, and retiring the target's own workspace
   * would silently discard its data. Instead this merges the source into
   * the target: documents whose content (sha256) already exists in the
   * target are dropped from the source (their dependents cascade away with
   * them), everything else workspace-scoped moves over, and the now-empty
   * source workspace is soft-deleted. The target workspace row itself is
   * never deleted or reassigned. When the target user has no workspace yet,
   * the common case, this is a plain reassignment as before.
   */
  async promoteToAccount(
    sourceWorkspaceId: string,
    newOwnerUserId: string,
  ): Promise<PromoteResult> {
    return getDb().transaction(async (tx) => {
      const target = await tx.query.workspaces.findFirst({
        where: and(
          eq(workspaces.ownerUserId, newOwnerUserId),
          isNull(workspaces.deletedAt),
          ne(workspaces.id, sourceWorkspaceId),
        ),
      });

      if (!target) {
        await tx
          .update(workspaces)
          .set({
            ownerUserId: newOwnerUserId,
            kind: "account",
            expiresAt: null,
            updatedAt: new Date(),
          })
          .where(eq(workspaces.id, sourceWorkspaceId));
        return { mode: "reassigned", workspaceId: sourceWorkspaceId };
      }

      const targetDocs = await tx
        .select({ sha256: documents.sha256 })
        .from(documents)
        .where(eq(documents.workspaceId, target.id));
      const duplicateShas = targetDocs.map((d) => d.sha256);

      // Cascades (see the documents/invoices/jobs/pipeline_runs foreign keys)
      // remove each duplicate's dependents along with it.
      await tx
        .delete(documents)
        .where(
          and(
            eq(documents.workspaceId, sourceWorkspaceId),
            inArray(documents.sha256, duplicateShas),
          ),
        );

      await tx
        .update(documents)
        .set({ workspaceId: target.id })
        .where(eq(documents.workspaceId, sourceWorkspaceId));
      await tx
        .update(invoices)
        .set({ workspaceId: target.id })
        .where(eq(invoices.workspaceId, sourceWorkspaceId));
      await tx
        .update(jobs)
        .set({ workspaceId: target.id })
        .where(eq(jobs.workspaceId, sourceWorkspaceId));
      await tx
        .update(usageLedger)
        .set({ workspaceId: target.id })
        .where(eq(usageLedger.workspaceId, sourceWorkspaceId));
      await tx
        .update(auditLog)
        .set({ workspaceId: target.id })
        .where(eq(auditLog.workspaceId, sourceWorkspaceId));

      await tx
        .update(workspaces)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(workspaces.id, sourceWorkspaceId));

      return { mode: "merged", workspaceId: target.id };
    });
  },

  async deleteCascade(id: string): Promise<void> {
    await getDb().delete(workspaces).where(eq(workspaces.id, id));
  },
};
