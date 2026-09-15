import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startGuestSession } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { getDb } from "@/lib/db/client";
import { usageLedger } from "@/lib/db/schema";
import { sha256Hex } from "@/lib/files/hash";
import { StageError } from "@/lib/pipeline/errors";
import { setModelProviderForTests } from "@/lib/pipeline/extract/model";
import { runJob } from "@/lib/pipeline/runner";
import { claimJobs } from "@/lib/queue/claim";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo } from "@/lib/repo/jobs";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";
import { usageRepo } from "@/lib/repo/usage";

// The daily budget sums the whole usage_ledger table (a single global cap, not per-workspace),
// so a row one test inserts to simulate today's spend would otherwise still be there, on the
// same real UTC day, when the next test in this file runs its own budget check.
beforeEach(async () => {
  await getDb().delete(usageLedger);
});

afterEach(() => setModelProviderForTests(null));

async function seed(name: string) {
  const { info } = await startGuestSession();
  const bytes = new TextEncoder().encode(`%PDF-1.4 ${name}`);
  const sha = sha256Hex(bytes);
  const blobKey = `${info.workspaceId}/${sha}.pdf`;
  await getBlobStore().put(blobKey, bytes, "application/pdf");
  const doc = await documentsRepo.create({ workspaceId: info.workspaceId, originalFilename: `${name}.pdf`, mime: "application/pdf", byteSize: bytes.length, sha256: sha, blobKey });
  await jobsRepo.enqueue({ workspaceId: info.workspaceId, documentId: doc.id, kind: "process_document" });
  const [claimed] = await claimJobs({ runnerId: "t", limit: 1, perWorkspace: 5, global: 5 });
  return { info, doc, claimed };
}

describe("runner guard rails", () => {
  it("defers to the next UTC midnight without spending an attempt when today's spend has reached the cap", async () => {
    const { info, doc, claimed } = await seed("budget");
    await usageRepo.record({ workspaceId: info.workspaceId, documentId: null, model: "claude-sonnet-5", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costMicros: 3_000_000 });
    let calls = 0;
    setModelProviderForTests({
      name: "live",
      extract: async () => {
        calls += 1;
        throw new Error("must not be called");
      },
    });
    await runJob(claimed);
    expect(calls).toBe(0);
    const job = await jobsRepo.getById(claimed.id);
    expect(job?.status).toBe("queued");
    expect(job?.attempts).toBe(0);
    expect(job!.runAfter.getTime()).toBeGreaterThan(Date.now());
    expect(job!.runAfter.getUTCHours()).toBe(0);
    expect(job!.runAfter.getUTCMinutes()).toBe(0);
    const after = await documentsRepo.getByIdUnscoped(doc.id);
    expect(after?.status).toBe("queued");
    expect(after?.failureCode).toBe("budget_paused");
    expect(after?.failureMessage).toContain("resumes");
    const runs = await pipelineRunsRepo.listByDocument(doc.id);
    const extractRun = runs.find((r) => r.stage === "extract");
    expect(extractRun?.status).toBe("skipped");
    expect(extractRun?.meta).toEqual({ reason: "budget_paused" });
  });

  it("marks a non-retryable stage error dead on the first attempt with its plain message", async () => {
    const { doc, claimed } = await seed("fatal");
    setModelProviderForTests({
      name: "live",
      extract: async () => {
        throw new StageError("model_refused", "The model declined to process this document.", "refusal", { retryable: false });
      },
    });
    await runJob(claimed);
    expect((await jobsRepo.getById(claimed.id))?.status).toBe("dead");
    const after = await documentsRepo.getByIdUnscoped(doc.id);
    expect(after?.status).toBe("failed");
    expect(after?.failureCode).toBe("model_refused");
    expect(after?.failureMessage).toBe("The model declined to process this document.");
  });
});
