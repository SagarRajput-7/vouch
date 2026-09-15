import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { pages } from "@/lib/db/schema";
import type { ParsedPage } from "@/lib/pipeline/types";

export type PageRow = typeof pages.$inferSelect;

export const pagesRepo = {
  async replaceForDocument(documentId: string, parsed: ParsedPage[]): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.delete(pages).where(eq(pages.documentId, documentId));
      if (parsed.length > 0) await tx.insert(pages).values(parsed.map((p) => ({ documentId, ...p })));
    });
  },

  async listByDocument(documentId: string): Promise<ParsedPage[]> {
    const rows = await getDb().query.pages.findMany({ where: eq(pages.documentId, documentId), orderBy: [asc(pages.pageNo)] });
    return rows.map((r) => ({
      pageNo: r.pageNo,
      width: r.width,
      height: r.height,
      rotation: r.rotation,
      textSource: r.textSource,
      ocrMeanConfidence: r.ocrMeanConfidence,
      tokens: r.tokens,
    }));
  },

  /** Page geometry without tokens, for API payloads. */
  async listSummaries(documentId: string): Promise<Array<Omit<ParsedPage, "tokens">>> {
    const rows = await getDb()
      .select({ pageNo: pages.pageNo, width: pages.width, height: pages.height, rotation: pages.rotation, textSource: pages.textSource, ocrMeanConfidence: pages.ocrMeanConfidence })
      .from(pages)
      .where(eq(pages.documentId, documentId))
      .orderBy(asc(pages.pageNo));
    return rows;
  },
};
