import { buildInvoice } from "@/lib/pipeline/draft";
import type { IssueDraft, Stage } from "@/lib/pipeline/types";
import { validateInvoice } from "@/lib/pipeline/validate/rules";
import { invoicesRepo } from "@/lib/repo/invoices";
import { issuesRepo } from "@/lib/repo/issues";
import { loadExtraction, loadGrounding, loadPages } from "./shared";

export const validateStage: Stage = {
  name: "validate",
  async run(ctx) {
    const extraction = await loadExtraction(ctx);
    const pages = await loadPages(ctx);
    const grounding = await loadGrounding(ctx);
    const draft = buildInvoice(extraction);
    const { vendorKey, invoiceNumber } = draft.header;
    const duplicate = vendorKey && invoiceNumber ? await invoicesRepo.findDuplicate(ctx.workspaceId, vendorKey, invoiceNumber, ctx.documentId) : null;
    const issues = validateInvoice({ draft, extraction, grounding, pages, duplicate, now: new Date() });
    await issuesRepo.replaceForDocument(ctx.documentId, issues);
    ctx.state.issues = issues;
    const count = (severity: IssueDraft["severity"]) => issues.filter((i) => i.severity === severity).length;
    return { meta: { blocking: count("blocking"), warning: count("warning"), info: count("info"), codes: [...new Set(issues.map((i) => i.code))] } };
  },
};
