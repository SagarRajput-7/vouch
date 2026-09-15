import { buildInvoice } from "@/lib/pipeline/draft";
import { StageError } from "@/lib/pipeline/errors";
import type { Stage } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { extractionsRepo } from "@/lib/repo/extractions";
import { invoicesRepo } from "@/lib/repo/invoices";

export const finaliseStage: Stage = {
  name: "finalise",
  async run(ctx) {
    const result = ctx.state.extraction ?? (await extractionsRepo.latest(ctx.documentId))?.result;
    if (!result) throw new StageError("no_extraction", "No extraction is available for this document.");
    const docType = result.docType.value === "other" ? "invoice" : result.docType.value;
    const built = buildInvoice(result);
    await invoicesRepo.upsertFromExtraction({
      documentId: ctx.documentId,
      workspaceId: ctx.workspaceId,
      docType,
      header: built.header,
      fields: built.fields,
      lineItems: built.lineItems,
    });
    await documentsRepo.setStatus(ctx.documentId, "needs_review");
    return { meta: { fields: Object.keys(built.fields).length, lineItems: built.lineItems.length } };
  },
};
