import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startGuestSession } from "@/lib/auth/session";
import { dbFlavour, getDb } from "@/lib/db/client";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo } from "@/lib/repo/jobs";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";
import { JOB_LIMITS, claimJobs, sweepStale } from "@/lib/queue/claim";

async function docInNewWorkspace() {
  const { info } = await startGuestSession();
  const doc = await documentsRepo.create({
    workspaceId: info.workspaceId,
    originalFilename: "a.pdf",
    mime: "application/pdf",
    byteSize: 1,
    sha256: crypto.randomUUID(),
    blobKey: `${info.workspaceId}/a.pdf`,
  });
  return { workspaceId: info.workspaceId, documentId: doc.id };
}

describe("job queue", () => {
  // Runs first deliberately: the jobs this file's other tests claim are left running rather
  // than completed, so the table's running count only stays at the clean, predictable 0 this
  // assertion needs if it runs before any of them.
  it("respects the global cap across workspaces", async () => {
    const a = await docInNewWorkspace();
    const b = await docInNewWorkspace();
    const c = await docInNewWorkspace();
    await jobsRepo.enqueue({ ...a, kind: "process_document" });
    await jobsRepo.enqueue({ ...b, kind: "process_document" });
    await jobsRepo.enqueue({ ...c, kind: "process_document" });
    const claimed = await claimJobs({ runnerId: "t", limit: 10, perWorkspace: 50, global: 2 });
    expect(claimed).toHaveLength(2);
    for (const job of claimed) expect(job.status).toBe("running");
  });

  it("claims queued jobs oldest first and marks them running", async () => {
    const a = await docInNewWorkspace();
    const j1 = await jobsRepo.enqueue({ ...a, kind: "process_document" });
    const claimed = await claimJobs({ runnerId: "t", limit: 5, perWorkspace: 2, global: 5 });
    expect(claimed.map((j) => j.id)).toContain(j1.id);
    expect(claimed.find((j) => j.id === j1.id)?.status).toBe("running");
    expect(claimed.find((j) => j.id === j1.id)?.attempts).toBe(1);
    const again = await claimJobs({ runnerId: "t2", limit: 5, perWorkspace: 2, global: 5 });
    expect(again.map((j) => j.id)).not.toContain(j1.id);
  });

  it("respects the per-workspace cap", async () => {
    const a = await docInNewWorkspace();
    await jobsRepo.enqueue({ ...a, kind: "process_document" });
    await jobsRepo.enqueue({ ...a, kind: "process_document" });
    await jobsRepo.enqueue({ ...a, kind: "process_document" });
    const claimed = await claimJobs({ runnerId: "t", limit: 10, perWorkspace: 2, global: 50 });
    const mine = claimed.filter((j) => j.workspaceId === a.workspaceId);
    expect(mine).toHaveLength(2);
  });

  it("fails with backoff and dies after max attempts", async () => {
    const a = await docInNewWorkspace();
    const job = await jobsRepo.enqueue({ ...a, kind: "process_document" });
    for (let attempt = 1; attempt <= JOB_LIMITS.maxAttempts; attempt++) {
      await getDb().execute(sql`update jobs set run_after = now() - interval '1 second' where id = ${job.id}`);
      const claimed = await claimJobs({ runnerId: "t", limit: 50, perWorkspace: 50, global: 50 });
      expect(claimed.map((j) => j.id)).toContain(job.id);
      await jobsRepo.fail(job.id, `boom ${attempt}`);
      const after = await jobsRepo.getById(job.id);
      if (attempt < JOB_LIMITS.maxAttempts) {
        expect(after?.status).toBe("queued");
        expect(after!.runAfter.getTime()).toBeGreaterThan(Date.now());
      } else {
        expect(after?.status).toBe("dead");
      }
    }
  });

  it("requeues stale running jobs", async () => {
    const a = await docInNewWorkspace();
    const job = await jobsRepo.enqueue({ ...a, kind: "process_document" });
    await claimJobs({ runnerId: "t", limit: 50, perWorkspace: 50, global: 50 });
    await getDb().execute(sql`update jobs set locked_at = now() - interval '10 minutes' where id = ${job.id}`);
    const swept = await sweepStale(JOB_LIMITS.staleMs);
    expect(swept).toBeGreaterThanOrEqual(1);
    expect((await jobsRepo.getById(job.id))?.status).toBe("queued");
  });

  it("closes the stage runs of a job that will not come back, and keeps those of one that will", async () => {
    const a = await docInNewWorkspace();
    const dead = await jobsRepo.enqueue({ ...a, kind: "process_document" });
    const retrying = await jobsRepo.enqueue({ ...a, kind: "process_document" });
    const deadRun = await pipelineRunsRepo.start(a.documentId, "extract", dead.id);
    const retryingRun = await pipelineRunsRepo.start(a.documentId, "parse", retrying.id);
    await getDb().execute(sql`update pipeline_runs set started_at = now() - interval '10 minutes' where id in (${deadRun.id}, ${retryingRun.id})`);
    await getDb().execute(sql`update jobs set status = 'dead' where id = ${dead.id}`);
    await getDb().execute(sql`update jobs set status = 'queued' where id = ${retrying.id}`);

    await sweepStale(JOB_LIMITS.staleMs);

    const runs = await pipelineRunsRepo.listByDocument(a.documentId);
    expect(runs.find((r) => r.id === deadRun.id)).toMatchObject({ status: "failed", error: "stale" });
    expect(runs.find((r) => r.id === deadRun.id)?.finishedAt).not.toBeNull();
    // The retrying job's own run is the marker the extract stage needs to recognise work it has
    // already paid for, so a sweep must not take it away while that job can still resume.
    expect(runs.find((r) => r.id === retryingRun.id)?.status).toBe("running");
  });

  it.skipIf(dbFlavour() === "pglite")("never double-claims under concurrency", async () => {
    const a = await docInNewWorkspace();
    const ids = new Set<string>();
    for (let i = 0; i < 6; i++) ids.add((await jobsRepo.enqueue({ ...a, kind: "process_document" })).id);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => claimJobs({ runnerId: `r${i}`, limit: 2, perWorkspace: 50, global: 50 })),
    );
    const claimed = results.flat().map((j) => j.id);
    expect(new Set(claimed).size).toBe(claimed.length);
  });
});
