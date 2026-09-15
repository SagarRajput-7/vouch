import { getBlobStore } from "@/lib/blob";
import type { SupportedMime } from "@/lib/files/detect-type";
import { log } from "@/lib/logger";
import { assertWithinBudget } from "@/lib/pipeline/budget";
import { StageError } from "@/lib/pipeline/errors";
import { getModelProvider } from "@/lib/pipeline/extract/model";
import type { ExtractionResult } from "@/lib/pipeline/extract/schema";
import type { ModelInput, ModelProvider, Stage, StageContext, StageOutcome } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { extractionsRepo } from "@/lib/repo/extractions";
import { issuesRepo } from "@/lib/repo/issues";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";
import { usageRepo } from "@/lib/repo/usage";

/**
 * Classifies the document and hands the extraction to the stages after this one. Splitting this
 * out keeps the two ways in here, a fresh answer and a recovered one, on exactly the same path.
 */
async function adopt(ctx: StageContext, result: ExtractionResult, meta: Record<string, unknown>): Promise<StageOutcome> {
  if (result.docType.value === "other") {
    await documentsRepo.update(ctx.documentId, { docType: "other" });
    await issuesRepo.replaceForDocument(ctx.documentId, [{ code: "V011", severity: "blocking", fieldPaths: [], message: result.docType.reason, suggestion: null }]);
    await documentsRepo.setStatus(ctx.documentId, "rejected", { code: "not_an_invoice", message: result.docType.reason });
    return { halt: true, meta: { ...meta, docType: "other", reason: result.docType.reason } };
  }
  await documentsRepo.update(ctx.documentId, { docType: result.docType.value });
  ctx.state.extraction = result;
  return { meta: { ...meta, docType: result.docType.value, lineItems: result.lineItems.length } };
}

/**
 * An answer an earlier attempt already paid for. A crash between recording the extraction and
 * checkpointing the run leaves the extraction in the database and that run stuck on "running";
 * re-entering the stage would otherwise buy the same answer a second time. Only an extraction
 * newer than the abandoned run counts, and a manual retry deletes every run row first, so a
 * document a person asked to reprocess is always read again.
 */
async function recoverable(ctx: StageContext): Promise<{ runId: string; result: ExtractionResult } | null> {
  const abandoned = await pipelineRunsRepo.latestAbandoned(ctx.documentId, "extract", ctx.runId);
  if (!abandoned) return null;
  const previous = await extractionsRepo.latestInitial(ctx.documentId);
  if (!previous || previous.row.createdAt <= abandoned.startedAt) return null;
  return { runId: abandoned.id, result: previous.result };
}

export const extractStage: Stage = {
  name: "extract",
  async run(ctx) {
    const recovered = await recoverable(ctx);
    if (recovered) {
      await pipelineRunsRepo.finish(recovered.runId, "failed", {}, "abandoned");
      log.warn("extract.reused", { documentId: ctx.documentId, abandonedRunId: recovered.runId });
      return adopt(ctx, recovered.result, { reused: true });
    }

    const blob = await getBlobStore().get(ctx.document.blobKey);
    if (!blob) throw new StageError("blob_missing", "The stored file could not be read.");

    const provider = getModelProvider();
    const input: ModelInput = {
      bytes: blob.bytes,
      mime: ctx.document.mime as SupportedMime,
      sha256: ctx.document.sha256,
      filename: ctx.document.originalFilename,
    };
    // A provider that can answer this exact call for free (the mock, or a replayed recording)
    // spends nothing, so an exhausted daily budget must not stop it. Everything else pays.
    if (!(await provider.isFree?.(input))) await assertWithinBudget();

    let extraction: Awaited<ReturnType<ModelProvider["extract"]>>;
    try {
      extraction = await provider.extract(input);
    } catch (err) {
      if (err instanceof StageError && err.usage) {
        await usageRepo.record({
          workspaceId: ctx.workspaceId,
          documentId: ctx.documentId,
          model: err.usage.model,
          inputTokens: err.usage.inputTokens,
          outputTokens: err.usage.outputTokens,
          cacheReadTokens: err.usage.cacheReadTokens,
          costMicros: err.usage.costMicros,
        });
      }
      throw err;
    }
    const { result, usage, raw, promptVersion } = extraction;

    await extractionsRepo.record({
      documentId: ctx.documentId,
      kind: "initial",
      model: usage.model,
      promptVersion,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      latencyMs: usage.latencyMs,
      result,
      raw,
    });
    await usageRepo.record({
      workspaceId: ctx.workspaceId,
      documentId: ctx.documentId,
      model: usage.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      costMicros: usage.costMicros,
    });

    return adopt(ctx, result, { model: usage.model, latencyMs: usage.latencyMs });
  },
};
