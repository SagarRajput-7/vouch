import { fieldNames, type ExtractionResult, type FieldName } from "@/lib/pipeline/extract/schema";
import type { Grounding, ParsedPage } from "@/lib/pipeline/types";
import { LABELS } from "./labels";
import { groundValue, preparePages, type TokenRange } from "./match";
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

/**
 * Header fields are grounded in this order and each claims its tokens from the next, so two
 * fields carrying the same amount cannot both take the first occurrence on the page. The totals
 * go first because they are the ones that carry a printed label to be drawn to.
 */
const MONEY_FIRST = ["total", "subtotal", "tax", "shipping", "discount"] as const;
const groundedFirst: ReadonlySet<string> = new Set(MONEY_FIRST);
const HEADER_ORDER: readonly FieldName[] = [...MONEY_FIRST, ...fieldNames.filter((f) => !groundedFirst.has(f))];

const LINE_COLUMNS = ["quantity", "unitPrice", "amount"] as const;

const range = (g: Grounding): TokenRange => ({ page: g.page, start: g.range[0], end: g.range[1] });
const row = (g: Grounding) => ({ page: g.page, line: g.line });

/** Locates every non-null value. Keys are field paths: `total`, `lineItems.2.amount`. */
export function groundExtraction(extraction: ExtractionResult, pages: ParsedPage[]): GroundingMap {
  const prepared = preparePages(pages);
  const out: GroundingMap = {};

  const header = new Map<FieldName, Grounding | null>();
  const claimed: TokenRange[] = [];
  for (const name of HEADER_ORDER) {
    const s = extraction.fields[name];
    const g = s.value === null ? null : groundValue(candidatesFor(KIND[name], s), prepared, { preferredPage: s.page, labels: LABELS[name], exclude: claimed });
    header.set(name, g);
    if (g) claimed.push(range(g));
  }
  // The map itself keeps the schema's field order, whatever order the values were found in.
  for (const name of fieldNames) out[name] = header.get(name) ?? null;

  // Descriptions claimed by earlier rows are excluded so identical descriptions map to successive rows.
  const usedDescriptions: TokenRange[] = [];
  extraction.lineItems.forEach((li, i) => {
    const desc =
      li.description.value === null
        ? null
        : groundValue(candidatesFor("text", li.description), prepared, { preferredPage: li.description.page, labels: [], exclude: usedDescriptions });
    out[`lineItems.${i}.description`] = desc;
    if (desc) usedDescriptions.push(range(desc));
    for (const col of LINE_COLUMNS) out[`lineItems.${i}.${col}`] = null;

    const used: TokenRange[] = desc ? [range(desc)] : [];
    let anchor: { page: number; line: number; afterIndex?: number } | null = desc ? { ...row(desc), afterIndex: desc.range[1] } : null;
    // With a description to anchor on, the cells are read left to right from it. Without one, the
    // amount and the unit price go first: they are amounts, so they cannot land on a page number,
    // and whichever of them grounds fixes the row the quantity is then allowed to search.
    const order = desc ? LINE_COLUMNS : (["amount", "unitPrice", "quantity"] as const);
    for (const col of order) {
      const s = li[col];
      // A quantity is usually a bare digit, which matches anywhere; it is only safe once a row is known.
      const searchable = s.value !== null && (col !== "quantity" || anchor !== null);
      const g = !searchable
        ? null
        : groundValue(candidatesFor(col === "quantity" ? "number" : "money", s), prepared, {
            preferredPage: s.page ?? anchor?.page ?? null,
            labels: [],
            nearLine: anchor,
            exclude: used,
            columnHint: col === "amount" ? "right" : "left",
          });
      out[`lineItems.${i}.${col}`] = g;
      if (g) {
        used.push(range(g));
        anchor ??= row(g);
      }
    }
  });
  return out;
}

/** Number of values the model produced, the denominator for a grounding rate. */
export function countValues(extraction: ExtractionResult): number {
  let n = fieldNames.filter((f) => extraction.fields[f].value !== null).length;
  for (const li of extraction.lineItems) n += (["description", ...LINE_COLUMNS] as const).filter((c) => li[c].value !== null).length;
  return n;
}
