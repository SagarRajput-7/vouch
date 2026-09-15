import type { FieldMeta, InvoiceFields, LineItemMeta } from "@/lib/db/schema";
import { parseMoney } from "@/lib/normalize/money";
import { vendorKey } from "@/lib/normalize/vendor";
import { fieldNames, type ExtractedScalar, type ExtractionResult } from "@/lib/pipeline/extract/schema";
import { computeRisk, criticalityFor } from "@/lib/pipeline/risk";

const MONEY_FIELDS = ["subtotal", "tax", "shipping", "discount", "total"] as const;

/** Field metadata before grounding runs: no location, so risk reflects only confidence and criticality. */
export function fieldMetaFrom(path: string, s: ExtractedScalar): FieldMeta {
  return {
    value: s.value,
    sourceText: s.sourceText,
    page: s.page,
    bbox: null,
    groundingScore: 0,
    groundingMethod: "none",
    modelConfidence: s.confidence,
    risk: computeRisk({ groundingScore: 0, blockingIssues: 0, warningIssues: 0, modelConfidence: s.confidence, criticality: criticalityFor(path) }),
    status: "pending",
    correctedAt: null,
  };
}

function money(s: ExtractedScalar): string | null {
  return s.value ? parseMoney(s.value) : null;
}

function isoDate(s: ExtractedScalar): string | null {
  if (!s.value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s.value) ? s.value : null;
}

export function buildInvoice(result: ExtractionResult) {
  const fields: InvoiceFields = {};
  for (const name of fieldNames) fields[name] = fieldMetaFrom(name, result.fields[name]);

  const lineItems = result.lineItems.map((li, idx) => {
    const meta: LineItemMeta = {
      description: fieldMetaFrom(`lineItems.${idx}.description`, li.description),
      quantity: fieldMetaFrom(`lineItems.${idx}.quantity`, li.quantity),
      unitPrice: fieldMetaFrom(`lineItems.${idx}.unitPrice`, li.unitPrice),
      amount: fieldMetaFrom(`lineItems.${idx}.amount`, li.amount),
    };
    return {
      idx,
      description: li.description.value,
      quantity: li.quantity.value ? parseMoney(li.quantity.value)?.replace(/(\.\d{2})$/, "$100") ?? null : null,
      unitPrice: li.unitPrice.value ? parseMoney(li.unitPrice.value)?.replace(/(\.\d{2})$/, "$100") ?? null : null,
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
