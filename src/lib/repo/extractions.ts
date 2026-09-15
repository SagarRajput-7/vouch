import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { extractions } from "@/lib/db/schema";
import { extractionResultSchema, type ExtractionResult } from "@/lib/pipeline/extract/schema";

export type Extraction = typeof extractions.$inferSelect;

/** A stored row is only usable if the result inside it still satisfies the current schema. */
function withResult(row: Extraction | undefined): { row: Extraction; result: ExtractionResult } | null {
  if (!row) return null;
  const parsed = extractionResultSchema.safeParse((row.raw as { result?: unknown }).result);
  return parsed.success ? { row, result: parsed.data } : null;
}

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
    adopted?: boolean;
  }): Promise<Extraction> {
    const { result, adopted = true, ...rest } = input;
    const [row] = await getDb()
      .insert(extractions)
      .values({ ...rest, adopted, raw: { result, providerRaw: input.raw } })
      .returning();
    return row;
  },

  /** The newest extraction the pipeline is using. Rejected reconcile attempts are skipped. */
  async latest(documentId: string): Promise<{ row: Extraction; result: ExtractionResult } | null> {
    const row = await getDb().query.extractions.findFirst({
      where: and(eq(extractions.documentId, documentId), eq(extractions.adopted, true)),
      orderBy: [desc(extractions.createdAt)],
    });
    return withResult(row);
  },

  /**
   * The newest first-look extraction, whatever its adoption state: the answer the extract stage
   * itself last paid for, which a re-entered stage can adopt instead of buying another.
   */
  async latestInitial(documentId: string): Promise<{ row: Extraction; result: ExtractionResult } | null> {
    const row = await getDb().query.extractions.findFirst({
      where: and(eq(extractions.documentId, documentId), eq(extractions.kind, "initial")),
      orderBy: [desc(extractions.createdAt)],
    });
    return withResult(row);
  },

  /** Kind of the newest row of any adoption state; "reconcile" means the one allowed pass has run. */
  async newestKind(documentId: string): Promise<"initial" | "reconcile" | null> {
    const row = await getDb().query.extractions.findFirst({
      where: eq(extractions.documentId, documentId),
      orderBy: [desc(extractions.createdAt)],
    });
    return row?.kind ?? null;
  },
};
