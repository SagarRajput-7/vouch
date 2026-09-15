/**
 * Adoption is tested on the clean sample with a deliberately incomplete first look, not on the
 * mismatch sample: that invoice prints a wrong total by design, so no faithful re-read of it can
 * be both grounded and arithmetically consistent and a second look there can only ever be rejected.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startGuestSession } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { sha256Hex } from "@/lib/files/hash";
import { setModelProviderForTests } from "@/lib/pipeline/extract/model";
import { manifestLookup, MockModelProvider } from "@/lib/pipeline/extract/mock-provider";
import type { ExtractionResult } from "@/lib/pipeline/extract/schema";
import { runJob } from "@/lib/pipeline/runner";
import { extractStage } from "@/lib/pipeline/stages/extract";
import { groundStage } from "@/lib/pipeline/stages/ground";
import { parseStage } from "@/lib/pipeline/stages/parse";
import { reconcileStage } from "@/lib/pipeline/stages/reconcile";
import { validateStage } from "@/lib/pipeline/stages/validate";
import type { ExtractOptions, ModelInput, ModelProvider } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { extractionsRepo } from "@/lib/repo/extractions";
import { invoicesRepo } from "@/lib/repo/invoices";
import { issuesRepo } from "@/lib/repo/issues";
import { jobsRepo } from "@/lib/repo/jobs";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

const STAGES = [parseStage, extractStage, groundStage, validateStage, reconcileStage];

async function seed(name: string) {
  const { info } = await startGuestSession();
  const bytes = new Uint8Array(await readFile(path.resolve("samples/out", `${name}.pdf`)));
  const sha = sha256Hex(bytes);
  const blobKey = `${info.workspaceId}/${sha}.pdf`;
  await getBlobStore().put(blobKey, bytes, "application/pdf");
  const doc = await documentsRepo.create({ workspaceId: info.workspaceId, originalFilename: `${name}.pdf`, mime: "application/pdf", byteSize: bytes.length, sha256: sha, blobKey });
  const job = await jobsRepo.enqueue({ workspaceId: info.workspaceId, documentId: doc.id, kind: "process_document" });
  return { doc, job };
}

/**
 * Replays ground truth for the first call and a caller-chosen result for the focused second call.
 * `firstLook` lets a test spoil the initial answer, which is the only way a re-read can be better.
 */
function twoStepProvider(
  second: (truth: ExtractionResult) => ExtractionResult,
  firstLook: (truth: ExtractionResult) => ExtractionResult = (r) => r,
): ModelProvider & { calls: ExtractOptions[] } {
  const mock = new MockModelProvider(manifestLookup);
  const calls: ExtractOptions[] = [];
  return {
    name: "live",
    calls,
    async extract(input: ModelInput, options?: ExtractOptions) {
      calls.push(options ?? {});
      const truth = await mock.extract(input);
      if (!options?.focus) return { ...truth, result: firstLook(truth.result) };
      return { ...truth, result: second(truth.result), usage: { ...truth.usage, model: "claude-sonnet-5", inputTokens: 10, outputTokens: 5, costMicros: 70 } };
    },
  };
}

/** A first look that missed the tax line: the total then contradicts the subtotal on its own. */
function withoutTax(truth: ExtractionResult): ExtractionResult {
  return { ...truth, fields: { ...truth.fields, tax: { ...truth.fields.tax, value: null, sourceText: null, page: null } } };
}

afterEach(() => setModelProviderForTests(null));

describe("reconcile stage", () => {
  it("does nothing when there is no arithmetic issue", async () => {
    const provider = twoStepProvider((r) => r);
    setModelProviderForTests(provider);
    const { doc, job } = await seed("clean-digital");
    await runJob(job, STAGES);
    expect(provider.calls).toHaveLength(1);
    const runs = await pipelineRunsRepo.listByDocument(doc.id);
    expect(runs.find((r) => r.stage === "reconcile")?.meta).toMatchObject({ skipped: "no_arithmetic_issue" });
  });

  it("adopts a second extraction that fills the missing tax and removes the blocking issue", async () => {
    const provider = twoStepProvider((r) => r, withoutTax);
    setModelProviderForTests(provider);
    const { doc, job } = await seed("clean-digital");
    await runJob(job, STAGES);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].focus?.fieldPaths).toEqual(["total", "subtotal"]);
    expect(provider.calls[1].focus?.reason).toContain("1764.48");
    expect((await issuesRepo.listByDocument(doc.id)).filter((i) => i.code === "V003")).toHaveLength(0);
    const latest = await extractionsRepo.latest(doc.id);
    expect(latest?.row.kind).toBe("reconcile");
    expect(latest?.result.fields.tax.value).toBe("134.48");
    const runs = await pipelineRunsRepo.listByDocument(doc.id);
    expect(runs.find((r) => r.stage === "reconcile")?.meta).toMatchObject({ adopted: true, blockingBefore: 1, blockingAfter: 0 });
    // Reconcile revises the extraction and the issues, never the stored invoice: finalise owns that.
    expect(await invoicesRepo.getByDocument(doc.workspaceId, doc.id)).toBeNull();
  });

  it("keeps the first extraction when the second is no better, and runs at most once per extraction", async () => {
    const provider = twoStepProvider((r) => r);
    setModelProviderForTests(provider);
    const { doc, job } = await seed("mismatch-total");
    await runJob(job, STAGES);
    expect(provider.calls).toHaveLength(2);
    expect((await issuesRepo.listByDocument(doc.id)).map((i) => i.code)).toEqual(["V003"]);
    const latest = await extractionsRepo.latest(doc.id);
    expect(latest?.row.kind).toBe("initial");
    expect(await extractionsRepo.newestKind(doc.id)).toBe("reconcile");
    const runs = await pipelineRunsRepo.listByDocument(doc.id);
    expect(runs.find((r) => r.stage === "reconcile")?.meta).toMatchObject({ adopted: false, blockingBefore: 1, blockingAfter: 1 });

    // A fresh context, as after a crash and re-claim, must not spend another model call.
    const fresh = (await documentsRepo.getByIdUnscoped(doc.id))!;
    const out = await reconcileStage.run({ documentId: fresh.id, workspaceId: fresh.workspaceId, jobId: job.id, document: fresh, state: {} });
    expect(out.meta).toMatchObject({ skipped: "already_reconciled" });
    expect(provider.calls).toHaveLength(2);
  });
});
