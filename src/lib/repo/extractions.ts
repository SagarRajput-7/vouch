import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { extractions } from "@/lib/db/schema";
import { extractionResultSchema, type ExtractionResult } from "@/lib/pipeline/extract/schema";

export type Extraction = typeof extractions.$inferSelect;

export const extractionsRepo = {
  async record(input: {
    documentId: string;
    kind: "initial" | "reconcile";
    model: string;
    promptVersion: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    latencyMs: number;
    result: ExtractionResult;
    raw: unknown;
  }): Promise<Extraction> {
    const { result, ...rest } = input;
    const [row] = await getDb()
      .insert(extractions)
      .values({ ...rest, raw: { result, providerRaw: input.raw } })
      .returning();
    return row;
  },

  async latest(documentId: string): Promise<{ row: Extraction; result: ExtractionResult } | null> {
    const row = await getDb().query.extractions.findFirst({
      where: eq(extractions.documentId, documentId),
      orderBy: [desc(extractions.createdAt)],
    });
    if (!row) return null;
    const parsed = extractionResultSchema.safeParse((row.raw as { result?: unknown }).result);
    return parsed.success ? { row, result: parsed.data } : null;
  },
};
