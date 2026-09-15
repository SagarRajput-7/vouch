import { buildInvoice, searchTextFor } from "@/lib/pipeline/draft";
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
    const docType = extraction.docType.value === "other" ? "invoice" : extraction.docType.value;
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
        highRisk: allMeta.filter((m) => m && m.risk >= 0.5).length,
        blockingIssues: issues.filter((i) => i.severity === "blocking").length,
      },
    };
  },
};
