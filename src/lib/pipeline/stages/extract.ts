import { getBlobStore } from "@/lib/blob";
import type { SupportedMime } from "@/lib/files/detect-type";
import { assertWithinBudget } from "@/lib/pipeline/budget";
import { StageError } from "@/lib/pipeline/errors";
import { getModelProvider } from "@/lib/pipeline/extract/model";
import { PROMPT_VERSION } from "@/lib/pipeline/extract/schema";
import type { Stage } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { extractionsRepo } from "@/lib/repo/extractions";
import { usageRepo } from "@/lib/repo/usage";

export const extractStage: Stage = {
  name: "extract",
  async run(ctx) {
    const blob = await getBlobStore().get(ctx.document.blobKey);
    if (!blob) throw new StageError("blob_missing", "The stored file could not be read.");

    const provider = getModelProvider();
    if (provider.name !== "mock") await assertWithinBudget();
    const { result, usage, raw } = await provider.extract({
      bytes: blob.bytes,
      mime: ctx.document.mime as SupportedMime,
      sha256: ctx.document.sha256,
      filename: ctx.document.originalFilename,
    });

    await extractionsRepo.record({
      documentId: ctx.documentId,
      kind: "initial",
      model: usage.model,
      promptVersion: PROMPT_VERSION,
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

    if (result.docType.value === "other") {
      await documentsRepo.update(ctx.documentId, { docType: "other" });
      await documentsRepo.setStatus(ctx.documentId, "rejected", { code: "not_an_invoice", message: result.docType.reason });
      return { halt: true, meta: { docType: "other", reason: result.docType.reason } };
    }

    await documentsRepo.update(ctx.documentId, { docType: result.docType.value });
    ctx.state.extraction = result;
    return { meta: { docType: result.docType.value, lineItems: result.lineItems.length, model: usage.model, latencyMs: usage.latencyMs } };
  },
};
