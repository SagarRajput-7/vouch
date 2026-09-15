import { fieldNames, type ExtractionResult, type FieldName } from "@/lib/pipeline/extract/schema";
import type { Grounding, ParsedPage } from "@/lib/pipeline/types";
import { LABELS } from "./labels";
import { groundValue, type TokenRange } from "./match";
import { candidatesFor, type CandidateKind } from "./normalize";

export type GroundingMap = Record<string, Grounding | null>;

const KIND: Record<FieldName, CandidateKind> = {
  vendorName: "text",
  invoiceNumber: "text",
  issueDate: "date",
  dueDate: "date",
  currency: "currency",
  subtotal: "money",
  tax: "money",
  shipping: "money",
  discount: "money",
  total: "money",
};

const range = (g: Grounding): TokenRange => ({ page: g.page, start: g.range[0], end: g.range[1] });

/** Locates every non-null value. Keys are field paths: `total`, `lineItems.2.amount`. */
export function groundExtraction(extraction: ExtractionResult, pages: ParsedPage[]): GroundingMap {
  const out: GroundingMap = {};
  for (const name of fieldNames) {
    const s = extraction.fields[name];
    out[name] = s.value === null ? null : groundValue(candidatesFor(KIND[name], s), pages, { preferredPage: s.page, labels: LABELS[name] });
  }
  // Descriptions claimed by earlier rows are excluded so identical descriptions map to successive rows.
  const usedDescriptions: TokenRange[] = [];
  extraction.lineItems.forEach((li, i) => {
    const desc = li.description.value === null
      ? null
      : groundValue(candidatesFor("text", li.description), pages, { preferredPage: li.description.page, labels: [], exclude: usedDescriptions });
    out[`lineItems.${i}.description`] = desc;
    if (desc) usedDescriptions.push(range(desc));
    const used: TokenRange[] = desc ? [range(desc)] : [];
    const near = desc ? { page: desc.page, line: desc.line, afterIndex: desc.range[1] } : null;
    for (const col of ["quantity", "unitPrice", "amount"] as const) {
      const s = li[col];
      const g = s.value === null
        ? null
        : groundValue(candidatesFor(col === "quantity" ? "number" : "money", s), pages, {
            preferredPage: s.page ?? near?.page ?? null,
            labels: [],
            nearLine: near,
            exclude: used,
            columnHint: col === "amount" ? "right" : "left",
          });
      out[`lineItems.${i}.${col}`] = g;
      if (g) used.push(range(g));
    }
  });
  return out;
}

/** Number of values the model produced, the denominator for a grounding rate. */
export function countValues(extraction: ExtractionResult): number {
  let n = fieldNames.filter((f) => extraction.fields[f].value !== null).length;
  for (const li of extraction.lineItems) n += (["description", "quantity", "unitPrice", "amount"] as const).filter((c) => li[c].value !== null).length;
  return n;
}
