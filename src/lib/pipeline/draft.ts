import type { FieldMeta, InvoiceFields, LineItemMeta } from "@/lib/db/schema";
import { parseDecimal, parseMoney } from "@/lib/normalize/money";
import { vendorKey } from "@/lib/normalize/vendor";
import { fieldNames, type ExtractedScalar, type ExtractionResult } from "@/lib/pipeline/extract/schema";
import type { GroundingMap } from "@/lib/pipeline/ground/extraction";
import { computeRisk, criticalityFor } from "@/lib/pipeline/risk";
import type { Grounding, IssueDraft } from "@/lib/pipeline/types";

const MONEY_FIELDS = ["subtotal", "tax", "shipping", "discount", "total"] as const;

export type IssueCounts = { blocking: number; warning: number };
export type BuildOptions = { grounding?: GroundingMap; issues?: IssueDraft[] };

/**
 * Field metadata the review screen renders. A null value has nothing to locate, so its
 * grounding counts as complete; the risk then comes only from issues naming the field.
 */
export function fieldMetaFrom(path: string, s: ExtractedScalar, g: Grounding | null, counts: IssueCounts): FieldMeta {
  const groundingScore = s.value === null ? 1 : (g?.groundingScore ?? 0);
  return {
    value: s.value,
    sourceText: s.sourceText,
    page: g?.page ?? s.page,
    bbox: g?.bbox ?? null,
    groundingScore: s.value === null ? 0 : groundingScore,
    groundingMethod: g?.groundingMethod ?? "none",
    modelConfidence: s.confidence,
    risk: computeRisk({ groundingScore, blockingIssues: counts.blocking, warningIssues: counts.warning, modelConfidence: s.confidence, criticality: criticalityFor(path) }),
    status: "pending",
    correctedAt: null,
  };
}

function countsFor(path: string, issues: IssueDraft[]): IssueCounts {
  const mine = issues.filter((i) => i.fieldPaths.includes(path));
  return { blocking: mine.filter((i) => i.severity === "blocking").length, warning: mine.filter((i) => i.severity === "warning").length };
}

function money(s: ExtractedScalar): string | null {
  return s.value ? parseMoney(s.value) : null;
}

function isoDate(s: ExtractedScalar): string | null {
  if (!s.value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s.value) ? s.value : null;
}

export function buildInvoice(result: ExtractionResult, opts: BuildOptions = {}) {
  const grounding = opts.grounding ?? {};
  const issues = opts.issues ?? [];
  const metaFor = (path: string, s: ExtractedScalar) => fieldMetaFrom(path, s, grounding[path] ?? null, countsFor(path, issues));

  const fields: InvoiceFields = {};
  for (const name of fieldNames) fields[name] = metaFor(name, result.fields[name]);

  const lineItems = result.lineItems.map((li, idx) => {
    const meta: LineItemMeta = {
      description: metaFor(`lineItems.${idx}.description`, li.description),
      quantity: metaFor(`lineItems.${idx}.quantity`, li.quantity),
      unitPrice: metaFor(`lineItems.${idx}.unitPrice`, li.unitPrice),
      amount: metaFor(`lineItems.${idx}.amount`, li.amount),
    };
    return {
      idx,
      description: li.description.value,
      // Four decimals, not cents: a metered line can price at 0.0125 and rounding here would
      // make the line maths disagree with a correct amount.
      quantity: li.quantity.value ? parseDecimal(li.quantity.value, 4) : null,
      unitPrice: li.unitPrice.value ? parseDecimal(li.unitPrice.value, 4) : null,
      amount: money(li.amount),
      meta,
    };
  });

  const vendorName = result.fields.vendorName.value;
  const header = {
    vendorName,
    vendorKey: vendorName ? vendorKey(vendorName) : null,
    invoiceNumber: result.fields.invoiceNumber.value,
    issueDate: isoDate(result.fields.issueDate),
    dueDate: isoDate(result.fields.dueDate),
    currency: result.fields.currency.value?.toUpperCase() ?? null,
    subtotal: money(result.fields.subtotal),
    tax: money(result.fields.tax),
    shipping: money(result.fields.shipping),
    discount: money(result.fields.discount),
    total: money(result.fields.total),
  };
  // A money value the model returned but we could not parse is a guaranteed review item.
  for (const f of MONEY_FIELDS) {
    if (result.fields[f].value && header[f] === null) fields[f].risk = 1;
  }

  return { header, fields, lineItems };
}

export type InvoiceDraft = ReturnType<typeof buildInvoice>;

/** What the ledger search indexes: vendor, number, currency, and line descriptions. */
export function searchTextFor(draft: InvoiceDraft): string {
  return [draft.header.vendorName, draft.header.invoiceNumber, draft.header.currency, ...draft.lineItems.map((li) => li.description)].filter(Boolean).join(" ");
}
