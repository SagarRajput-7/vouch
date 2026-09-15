import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { issues } from "@/lib/db/schema";
import type { IssueDraft } from "@/lib/pipeline/types";

export type Issue = typeof issues.$inferSelect;

const severityOrder = sql`case ${issues.severity} when 'blocking' then 0 when 'warning' then 1 else 2 end`;

export const issuesRepo = {
  /** Validation owns the document's issues: every run replaces them wholesale. */
  async replaceForDocument(documentId: string, drafts: IssueDraft[]): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.delete(issues).where(eq(issues.documentId, documentId));
      if (drafts.length > 0) {
        await tx.insert(issues).values(drafts.map((d) => ({ documentId, code: d.code, severity: d.severity, fieldPaths: d.fieldPaths, message: d.message, suggestion: d.suggestion })));
      }
    });
  },

  async listByDocument(documentId: string): Promise<Issue[]> {
    return getDb().select().from(issues).where(eq(issues.documentId, documentId)).orderBy(severityOrder, asc(issues.code), asc(issues.createdAt));
  },

  async listOpenDrafts(documentId: string): Promise<IssueDraft[]> {
    const rows = await this.listByDocument(documentId);
    return rows
      .filter((r) => r.status === "open")
      .map((r) => ({ code: r.code, severity: r.severity, fieldPaths: r.fieldPaths, message: r.message, suggestion: (r.suggestion as Record<string, unknown> | null) ?? null }));
  },
};
