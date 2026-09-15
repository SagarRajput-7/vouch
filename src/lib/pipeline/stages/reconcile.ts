import { getBlobStore } from "@/lib/blob";
import type { SupportedMime } from "@/lib/files/detect-type";
import { log } from "@/lib/logger";
import { assertWithinBudget, BudgetExceededError } from "@/lib/pipeline/budget";
import { StageError } from "@/lib/pipeline/errors";
import { getModelProvider } from "@/lib/pipeline/extract/model";
import { groundExtraction } from "@/lib/pipeline/ground/extraction";
import type { ModelProvider, Stage, StageContext, StageOutcome } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { extractionsRepo } from "@/lib/repo/extractions";
import { issuesRepo } from "@/lib/repo/issues";
import { usageRepo } from "@/lib/repo/usage";
import { loadIssues, loadPages, revalidate } from "./shared";

const ARITHMETIC = new Set(["V002", "V003"]);
const blockingCount = (issues: Array<{ severity: string }>) => issues.filter((i) => i.severity === "blocking").length;

/**
 * Re-entry after the stage has already run once. The adopted extraction row is written before the
 * issues and the docType that belong to it, so a crash in between would leave a reviewer reading
 * the first look's issues against the second look's values, and the blocking issue they read would
 * send this stage straight back to `already_reconciled` without ever repairing it. Recomputing both
 * from the adopted row is cheap, costs no model call, and makes the skip path safe to re-enter.
 * A rejected second look changed nothing, so there is nothing to repair.
 */
async function repairAdopted(ctx: StageContext): Promise<StageOutcome> {
  const latest = await extractionsRepo.latest(ctx.documentId);
  if (latest?.row.kind !== "reconcile") return { meta: { skipped: "already_reconciled" } };
  const pages = await loadPages(ctx);
  const grounding = groundExtraction(latest.result, pages);
  const issues = await revalidate(ctx, latest.result, grounding, pages);
  await issuesRepo.replaceForDocument(ctx.documentId, issues);
  ctx.state.extraction = latest.result;
  ctx.state.grounding = grounding;
  ctx.state.issues = issues;
  await documentsRepo.update(ctx.documentId, { docType: latest.result.docType.value });
  return { meta: { skipped: "already_reconciled", repaired: true } };
}

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
    if ((await extractionsRepo.newestKind(ctx.documentId)) === "reconcile") return repairAdopted(ctx);

    const blob = await getBlobStore().get(ctx.document.blobKey);
    if (!blob) throw new StageError("blob_missing", "The stored file could not be read.");
    const provider = getModelProvider();
    if (provider.name !== "mock") {
      try {
        await assertWithinBudget();
      } catch (err) {
        // This document is already extracted, grounded and validated: the second look is an
        // optional improvement. Pausing here would defer the job past finalise and leave a
        // reviewable document queued until tomorrow, so reconcile degrades instead.
        if (!(err instanceof BudgetExceededError)) throw err;
        log.warn("reconcile.budget_paused", { documentId: ctx.documentId });
        return { meta: { skipped: "budget_paused" } };
      }
    }

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
    const secondIssues = await revalidate(ctx, result, grounding, pages);
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
    return { meta: { adopted, blockingBefore: before, blockingAfter: after, docType: result.docType.value, model: usage.model, latencyMs: usage.latencyMs, costMicros: usage.costMicros } };
  },
};
