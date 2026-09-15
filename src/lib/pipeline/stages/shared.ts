import { buildInvoice } from "@/lib/pipeline/draft";
import { StageError } from "@/lib/pipeline/errors";
import type { ExtractionResult } from "@/lib/pipeline/extract/schema";
import { groundExtraction, type GroundingMap } from "@/lib/pipeline/ground/extraction";
import type { IssueDraft, ParsedPage, StageContext } from "@/lib/pipeline/types";
import { validateInvoice } from "@/lib/pipeline/validate/rules";
import { extractionsRepo } from "@/lib/repo/extractions";
import { invoicesRepo } from "@/lib/repo/invoices";
import { issuesRepo } from "@/lib/repo/issues";
import { pagesRepo } from "@/lib/repo/pages";

/**
 * Stage outputs live in ctx.state for the current run and are reloaded from their tables when
 * a later stage runs in a fresh process after a checkpoint. Grounding is a pure function of the
 * extraction and the pages, so it is recomputed rather than stored.
 */
export async function loadExtraction(ctx: StageContext): Promise<ExtractionResult> {
  // Not `??=`: an absent extraction is a stage failure, not a value to assign.
  if (!ctx.state.extraction) {
    const latest = await extractionsRepo.latest(ctx.documentId);
    if (!latest) throw new StageError("no_extraction", "No extraction is available for this document.");
    ctx.state.extraction = latest.result;
  }
  return ctx.state.extraction;
}

export async function loadPages(ctx: StageContext): Promise<ParsedPage[]> {
  ctx.state.pages ??= await pagesRepo.listByDocument(ctx.documentId);
  return ctx.state.pages;
}

export async function loadGrounding(ctx: StageContext): Promise<GroundingMap> {
  ctx.state.grounding ??= groundExtraction(await loadExtraction(ctx), await loadPages(ctx));
  return ctx.state.grounding;
}

export async function loadIssues(ctx: StageContext): Promise<IssueDraft[]> {
  ctx.state.issues ??= await issuesRepo.listOpenDrafts(ctx.documentId);
  return ctx.state.issues;
}

/**
 * The issues that belong to one extraction: draft, duplicate check, rules. Validate and reconcile
 * both need it, and a document whose issues were computed a second way would be a document whose
 * review list disagrees with its values, so there is one implementation rather than two.
 */
export async function revalidate(ctx: StageContext, extraction: ExtractionResult, grounding: GroundingMap, pages: ParsedPage[]): Promise<IssueDraft[]> {
  const draft = buildInvoice(extraction);
  const { vendorKey, invoiceNumber } = draft.header;
  const duplicate = vendorKey && invoiceNumber ? await invoicesRepo.findDuplicate(ctx.workspaceId, vendorKey, invoiceNumber, ctx.documentId) : null;
  return validateInvoice({ draft, extraction, grounding, pages, duplicate, now: new Date() });
}
