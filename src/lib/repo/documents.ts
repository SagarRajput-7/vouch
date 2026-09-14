import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";

export type Document = typeof documents.$inferSelect;
export type DocumentStatus = Document["status"];
export type NewDocument = {
  workspaceId: string;
  originalFilename: string;
  mime: string;
  byteSize: number;
  sha256: string;
  blobKey: string;
  kind?: Document["kind"];
};

export const documentsRepo = {
  async create(input: NewDocument): Promise<Document> {
    const [row] = await getDb().insert(documents).values(input).returning();
    return row;
  },

  async getById(workspaceId: string, id: string): Promise<Document | null> {
    const row = await getDb().query.documents.findFirst({
      where: and(eq(documents.workspaceId, workspaceId), eq(documents.id, id)),
    });
    return row ?? null;
  },

  /** Internal use by the pipeline, which already holds a trusted document id. */
  async getByIdUnscoped(id: string): Promise<Document | null> {
    const row = await getDb().query.documents.findFirst({ where: eq(documents.id, id) });
    return row ?? null;
  },

  async listByWorkspace(workspaceId: string): Promise<Document[]> {
    return getDb().query.documents.findMany({
      where: eq(documents.workspaceId, workspaceId),
      orderBy: [desc(documents.createdAt)],
    });
  },

  async findBySha(workspaceId: string, sha256: string): Promise<Document | null> {
    const row = await getDb().query.documents.findFirst({
      where: and(eq(documents.workspaceId, workspaceId), eq(documents.sha256, sha256)),
    });
    return row ?? null;
  },

  async countByWorkspace(workspaceId: string): Promise<number> {
    const [row] = await getDb().select({ n: count() }).from(documents).where(eq(documents.workspaceId, workspaceId));
    return Number(row?.n ?? 0);
  },

  async setStatus(id: string, status: DocumentStatus, failure?: { code: string; message: string }): Promise<void> {
    await getDb()
      .update(documents)
      .set({
        status,
        failureCode: failure?.code ?? null,
        failureMessage: failure?.message ?? null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id));
  },

  async update(id: string, patch: Partial<Pick<Document, "kind" | "pageCount" | "docType">>): Promise<void> {
    await getDb().update(documents).set({ ...patch, updatedAt: new Date() }).where(eq(documents.id, id));
  },

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const rows = await getDb()
      .delete(documents)
      .where(and(eq(documents.workspaceId, workspaceId), eq(documents.id, id)))
      .returning({ id: documents.id });
    return rows.length > 0;
  },
};
