import { countValues, groundExtraction } from "@/lib/pipeline/ground/extraction";
import type { Stage } from "@/lib/pipeline/types";
import { loadExtraction, loadPages } from "./shared";

export const groundStage: Stage = {
  name: "ground",
  async run(ctx) {
    const extraction = await loadExtraction(ctx);
    const pages = await loadPages(ctx);
    const grounding = groundExtraction(extraction, pages);
    ctx.state.grounding = grounding;
    const byMethod = { exact: 0, normalized: 0, fuzzy: 0 };
    for (const g of Object.values(grounding)) if (g) byMethod[g.groundingMethod] += 1;
    const values = countValues(extraction);
    const grounded = byMethod.exact + byMethod.normalized + byMethod.fuzzy;
    return { meta: { values, grounded, ungrounded: values - grounded, byMethod } };
  },
};
