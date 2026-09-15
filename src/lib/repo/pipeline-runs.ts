import { and, asc, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { pipelineRuns } from "@/lib/db/schema";

export type PipelineRun = typeof pipelineRuns.$inferSelect;

export const pipelineRunsRepo = {
  async start(documentId: string, stage: string, jobId: string | null): Promise<PipelineRun> {
    const [row] = await getDb().insert(pipelineRuns).values({ documentId, stage, jobId }).returning();
    return row;
  },

  async finish(
    runId: string,
    status: "succeeded" | "failed" | "skipped",
    meta: Record<string, unknown> = {},
    error?: string,
  ): Promise<void> {
    const db = getDb();
    const run = await db.query.pipelineRuns.findFirst({ where: eq(pipelineRuns.id, runId) });
    const finishedAt = new Date();
    await db
      .update(pipelineRuns)
      .set({
        status,
        finishedAt,
        durationMs: run ? finishedAt.getTime() - run.startedAt.getTime() : null,
        meta,
        error: error ?? null,
      })
      .where(eq(pipelineRuns.id, runId));
  },

  async hasSucceeded(documentId: string, stage: string): Promise<boolean> {
    const row = await getDb().query.pipelineRuns.findFirst({
      where: and(eq(pipelineRuns.documentId, documentId), eq(pipelineRuns.stage, stage), eq(pipelineRuns.status, "succeeded")),
    });
    return Boolean(row);
  },

  /**
   * The newest run of this stage still marked `running` that is not the caller's own. A row can
   * only be left that way by an attempt that died mid-stage, since the runner finishes every run
   * it starts, so it marks the boundary after which any work that attempt recorded is recoverable.
   */
  async latestAbandoned(documentId: string, stage: string, excludeRunId: string): Promise<PipelineRun | null> {
    const row = await getDb().query.pipelineRuns.findFirst({
      where: and(
        eq(pipelineRuns.documentId, documentId),
        eq(pipelineRuns.stage, stage),
        eq(pipelineRuns.status, "running"),
        ne(pipelineRuns.id, excludeRunId),
      ),
      orderBy: [desc(pipelineRuns.startedAt)],
    });
    return row ?? null;
  },

  async listByDocument(documentId: string): Promise<PipelineRun[]> {
    return getDb().query.pipelineRuns.findMany({
      where: eq(pipelineRuns.documentId, documentId),
      orderBy: [asc(pipelineRuns.startedAt)],
    });
  },

  /** Manual retry reprocesses from scratch: clears every checkpoint so no stage is skipped. */
  async deleteByDocument(documentId: string): Promise<number> {
    const rows = await getDb()
      .delete(pipelineRuns)
      .where(eq(pipelineRuns.documentId, documentId))
      .returning({ id: pipelineRuns.id });
    return rows.length;
  },
};
