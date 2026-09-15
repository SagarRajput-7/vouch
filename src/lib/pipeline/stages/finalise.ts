import { buildInvoice, searchTextFor } from "@/lib/pipeline/draft";
import { StageError } from "@/lib/pipeline/errors";
import { riskBand } from "@/lib/pipeline/risk";
import type { Stage } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { invoicesRepo } from "@/lib/repo/invoices";
import { loadExtraction, loadGrounding, loadIssues } from "./shared";

export const finaliseStage: Stage = {
  name: "finalise",
  async run(ctx) {
    const extraction = await loadExtraction(ctx);
    const grounding = await loadGrounding(ctx);
    const issues = await loadIssues(ctx);
    const built = buildInvoice(extraction, { grounding, issues });
    // The extract stage halts the pipeline as soon as it classifies a document as "other" (see
    // extract.ts), so finalise can never actually observe it; the throw documents that invariant
    // instead of silently coercing an unreachable case to "invoice".
    const docType = extraction.docType.value;
    if (docType === "other") {
      throw new StageError("not_an_invoice", "This document is not an invoice.", undefined, { retryable: false });
    }
    await invoicesRepo.upsertFromExtraction({
      documentId: ctx.documentId,
      workspaceId: ctx.workspaceId,
      docType,
      header: built.header,
      fields: built.fields,
      lineItems: built.lineItems,
      searchText: searchTextFor(built),
    });
    await documentsRepo.setStatus(ctx.documentId, "needs_review");
    const allMeta = [...Object.values(built.fields), ...built.lineItems.flatMap((li) => Object.values(li.meta))];
    return {
      meta: {
        fields: Object.keys(built.fields).length,
        lineItems: built.lineItems.length,
        highRisk: allMeta.filter((m) => m && riskBand(m.risk) === "high").length,
        blockingIssues: issues.filter((i) => i.severity === "blocking").length,
      },
    };
  },
};
