import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startGuestSession } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { sha256Hex } from "@/lib/files/hash";
import { runJob } from "@/lib/pipeline/runner";
import { extractStage } from "@/lib/pipeline/stages/extract";
import { parseStage } from "@/lib/pipeline/stages/parse";
import { claimJobs } from "@/lib/queue/claim";
import { drain } from "@/lib/queue/drain";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo } from "@/lib/repo/jobs";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

async function seed() {
  const { info } = await startGuestSession();
  const bytes = new Uint8Array(await readFile(path.resolve("samples/out", "clean-digital.pdf")));
  const sha = sha256Hex(bytes);
  const blobKey = `${info.workspaceId}/${sha}.pdf`;
  await getBlobStore().put(blobKey, bytes, "application/pdf");
  const doc = await documentsRepo.create({ workspaceId: info.workspaceId, originalFilename: "deadline.pdf", mime: "application/pdf", byteSize: bytes.length, sha256: sha, blobKey });
  const job = await jobsRepo.enqueue({ workspaceId: info.workspaceId, documentId: doc.id, kind: "process_document" });
  return { docId: doc.id, jobId: job.id };
}

const claim = async () => (await claimJobs({ runnerId: "deadline", limit: 1, perWorkspace: 5, global: 5 }))[0];

async function stages(docId: string): Promise<string[]> {
  return (await pipelineRunsRepo.listByDocument(docId)).map((r) => `${r.stage}:${r.status}`);
}

describe("per-job deadline", () => {
  it("parks a job at the last stage boundary that fits and resumes it from there", async () => {
    const s = await seed();

    // No time for anything: the job is handed straight back, with the attempt the claim spent
    // returned and nothing recorded against the document.
    const first = await claim();
    expect(first.attempts).toBe(1);
    await runJob(first, [parseStage, extractStage], { deadline: Date.now() + 1 });
    const parked = await jobsRepo.getById(s.jobId);
    expect(parked?.status).toBe("queued");
    expect(parked?.attempts).toBe(0);
    expect(parked?.lastError).toContain("deadline");
    expect(await stages(s.docId)).toEqual([]);
    const queuedDoc = await documentsRepo.getByIdUnscoped(s.docId);
    expect(queuedDoc?.status).toBe("queued");
    expect(queuedDoc?.failureCode).toBeNull();

    // Room for parse (140s of budget) but not for extract (200s): parse checkpoints and the job
    // is parked again before the stage that cannot finish.
    const second = await claim();
    await runJob(second, [parseStage, extractStage], { deadline: Date.now() + 150_000 });
    expect(await stages(s.docId)).toEqual(["parse:succeeded"]);
    expect((await jobsRepo.getById(s.jobId))?.status).toBe("queued");
    expect((await documentsRepo.getByIdUnscoped(s.docId))?.status).toBe("queued");

    // Without a deadline the resumed job skips the checkpointed parse and finishes.
    const third = await claim();
    await runJob(third, [parseStage, extractStage]);
    expect(await stages(s.docId)).toEqual(["parse:succeeded", "extract:succeeded"]);
    expect((await jobsRepo.getById(s.jobId))?.status).toBe("succeeded");
  }, 60_000);

  it("stops draining when a job parks, instead of claiming the same job straight back", async () => {
    // A parked job is queued to run again immediately and is the oldest, so a claim loop that
    // kept going would pick it up, park it, and pick it up again until its window closed, never
    // reaching the newer job. Parse is checkpointed first so the park lands on extract (200s of
    // budget against the 145s handed to the drain) without depending on how fast this machine is.
    const first = await seed();
    const second = await seed();
    await runJob((await claim())!, [parseStage]);
    await jobsRepo.requeue(first.jobId);

    const result = await drain({ runnerId: "deadline-drain", reason: "test", deadlineMs: 145_000 });

    expect(result.claimed).toBe(1);
    const parked = await jobsRepo.getById(first.jobId);
    expect(parked?.status).toBe("queued");
    expect(parked?.attempts).toBe(0);
    expect((await stages(first.docId)).filter((s) => s.startsWith("extract"))).toEqual([]);
    const untouched = await jobsRepo.getById(second.jobId);
    expect(untouched?.status).toBe("queued");
    expect(untouched?.attempts).toBe(0);
    expect(await stages(second.docId)).toEqual([]);
  }, 60_000);
});
