import type { IssueDraft, Stage } from "@/lib/pipeline/types";
import { issuesRepo } from "@/lib/repo/issues";
import { loadExtraction, loadGrounding, loadPages, revalidate } from "./shared";

export const validateStage: Stage = {
  name: "validate",
  async run(ctx) {
    const extraction = await loadExtraction(ctx);
    const pages = await loadPages(ctx);
    const grounding = await loadGrounding(ctx);
    const issues = await revalidate(ctx, extraction, grounding, pages);
    await issuesRepo.replaceForDocument(ctx.documentId, issues);
    ctx.state.issues = issues;
    const count = (severity: IssueDraft["severity"]) => issues.filter((i) => i.severity === severity).length;
    return { meta: { blocking: count("blocking"), warning: count("warning"), info: count("info"), codes: [...new Set(issues.map((i) => i.code))] } };
  },
};
