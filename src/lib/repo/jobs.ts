import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";

export type Job = typeof jobs.$inferSelect;

export const JOB_LIMITS = { perWorkspace: 2, global: 5, maxAttempts: 3, staleMs: 6 * 60_000 } as const;

export function backoffMs(attempts: number): number {
  return 30_000 * 2 ** Math.max(0, attempts - 1);
}

export const jobsRepo = {
  async enqueue(input: { workspaceId: string; documentId: string | null; kind: string }): Promise<Job> {
    const [row] = await getDb()
      .insert(jobs)
      .values({ ...input, maxAttempts: JOB_LIMITS.maxAttempts })
      .returning();
    return row;
  },

  async getById(id: string): Promise<Job | null> {
    const row = await getDb().query.jobs.findFirst({ where: eq(jobs.id, id) });
    return row ?? null;
  },

  async latestForDocument(documentId: string): Promise<Job | null> {
    const row = await getDb().query.jobs.findFirst({
      where: eq(jobs.documentId, documentId),
      orderBy: [desc(jobs.createdAt)],
    });
    return row ?? null;
  },

  async complete(id: string): Promise<void> {
    await getDb()
      .update(jobs)
      .set({ status: "succeeded", lockedAt: null, lockedBy: null, updatedAt: new Date() })
      .where(eq(jobs.id, id));
  },

  /** Requeues with exponential backoff, or marks dead once attempts are exhausted. */
  async fail(id: string, error: string): Promise<Job | null> {
    const db = getDb();
    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!job) return null;
    const dead = job.attempts >= job.maxAttempts;
    const [row] = await db
      .update(jobs)
      .set({
        status: dead ? "dead" : "queued",
        runAfter: dead ? job.runAfter : new Date(Date.now() + backoffMs(job.attempts)),
        lastError: error.slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id))
      .returning();
    return row;
  },

  /** Manual retry from the UI. Resets attempts so the user gets a full budget again. */
  async requeue(id: string): Promise<void> {
    await getDb()
      .update(jobs)
      .set({ status: "queued", attempts: 0, runAfter: new Date(), lastError: null, lockedAt: null, lockedBy: null, updatedAt: new Date() })
      .where(eq(jobs.id, id));
  },

  /** With a workspace id, counts only that workspace's queued jobs; without one, counts globally. */
  async countQueued(workspaceId?: string): Promise<number> {
    const where = workspaceId
      ? and(eq(jobs.status, "queued"), eq(jobs.workspaceId, workspaceId))
      : eq(jobs.status, "queued");
    const [row] = await getDb().select({ n: count() }).from(jobs).where(where);
    return Number(row?.n ?? 0);
  },
};
