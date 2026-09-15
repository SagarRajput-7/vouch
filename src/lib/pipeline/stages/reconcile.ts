import { getBlobStore } from "@/lib/blob";
import type { SupportedMime } from "@/lib/files/detect-type";
import { assertWithinBudget } from "@/lib/pipeline/budget";
import { buildInvoice } from "@/lib/pipeline/draft";
import { StageError } from "@/lib/pipeline/errors";
import { getModelProvider } from "@/lib/pipeline/extract/model";
import { groundExtraction } from "@/lib/pipeline/ground/extraction";
import type { ModelProvider, Stage } from "@/lib/pipeline/types";
import { validateInvoice } from "@/lib/pipeline/validate/rules";
import { documentsRepo } from "@/lib/repo/documents";
import { extractionsRepo } from "@/lib/repo/extractions";
import { invoicesRepo } from "@/lib/repo/invoices";
import { issuesRepo } from "@/lib/repo/issues";
import { usageRepo } from "@/lib/repo/usage";
import { loadIssues, loadPages } from "./shared";

const ARITHMETIC = new Set(["V002", "V003"]);
const blockingCount = (issues: Array<{ severity: string }>) => issues.filter((i) => i.severity === "blocking").length;

/**
 * When validation found an arithmetic contradiction, ask the model once more with the failing
 * fields named. The second answer replaces the first only if it has fewer blocking issues, so a
 * worse re-read can never make a document harder to review.
 */
export const reconcileStage: Stage = {
  name: "reconcile",
  async run(ctx) {
    const issues = await loadIssues(ctx);
    const arithmetic = issues.filter((i) => i.severity === "blocking" && ARITHMETIC.has(i.code));
    if (arithmetic.length === 0) return { meta: { skipped: "no_arithmetic_issue" } };
    if ((await extractionsRepo.newestKind(ctx.documentId)) === "reconcile") return { meta: { skipped: "already_reconciled" } };

    const blob = await getBlobStore().get(ctx.document.blobKey);
    if (!blob) throw new StageError("blob_missing", "The stored file could not be read.");
    const provider = getModelProvider();
    if (provider.name !== "mock") await assertWithinBudget();

    const focus = { fieldPaths: [...new Set(arithmetic.flatMap((i) => i.fieldPaths))], reason: arithmetic.map((i) => i.message).join(" ") };
    let attempt: Awaited<ReturnType<ModelProvider["extract"]>>;
    try {
      attempt = await provider.extract(
        { bytes: blob.bytes, mime: ctx.document.mime as SupportedMime, sha256: ctx.document.sha256, filename: ctx.document.originalFilename },
        { focus },
      );
    } catch (err) {
      // A refused or truncated second look still costs tokens, so the ledger hears about it.
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
    const { result, usage, raw, promptVersion } = attempt;

    const pages = await loadPages(ctx);
    const grounding = groundExtraction(result, pages);
    const draft = buildInvoice(result);
    const { vendorKey, invoiceNumber } = draft.header;
    const duplicate = vendorKey && invoiceNumber ? await invoicesRepo.findDuplicate(ctx.workspaceId, vendorKey, invoiceNumber, ctx.documentId) : null;
    const secondIssues = validateInvoice({ draft, extraction: result, grounding, pages, duplicate, now: new Date() });
    const before = blockingCount(issues);
    const after = blockingCount(secondIssues);
    const adopted = result.docType.value !== "other" && after < before;

    await extractionsRepo.record({
      documentId: ctx.documentId,
      kind: "reconcile",
      model: usage.model,
      promptVersion,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      latencyMs: usage.latencyMs,
      result,
      raw: { ...(typeof raw === "object" && raw ? raw : { raw }), focus, adopted },
      adopted,
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

    if (adopted) {
      ctx.state.extraction = result;
      ctx.state.grounding = grounding;
      ctx.state.issues = secondIssues;
      await issuesRepo.replaceForDocument(ctx.documentId, secondIssues);
      await documentsRepo.update(ctx.documentId, { docType: result.docType.value });
    }
    return { meta: { adopted, blockingBefore: before, blockingAfter: after, model: usage.model, latencyMs: usage.latencyMs, costMicros: usage.costMicros } };
  },
};
