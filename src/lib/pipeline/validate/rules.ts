import { absCents, fromCents, mulToCents, toCents } from "@/lib/normalize/money";
import type { InvoiceDraft } from "@/lib/pipeline/draft";
import type { ExtractionResult, FieldName } from "@/lib/pipeline/extract/schema";
import type { GroundingMap } from "@/lib/pipeline/ground/extraction";
import type { IssueDraft, ParsedPage } from "@/lib/pipeline/types";
import { isAdjacentTransposition } from "./transposition";

export type ValidationContext = {
  draft: InvoiceDraft;
  extraction: ExtractionResult;
  grounding: GroundingMap;
  pages: ParsedPage[];
  duplicate: { documentId: string; filename: string } | null;
  now: Date;
};

export type CorrectionSuggestion = { fieldPath: string; value: string; reason: string };

type Severity = IssueDraft["severity"];
type Header = InvoiceDraft["header"];
/** Header keys that are also extraction fields, so a rule can read both the parsed value and the printed source text. */
type HeaderField = Extract<FieldName, keyof Header>;

const ZERO = BigInt(0);
const REQUIRED: Array<[keyof Header, string]> = [["vendorName", "Vendor name"], ["invoiceNumber", "Invoice number"], ["issueDate", "Issue date"], ["currency", "Currency"], ["total", "Total"]];
const HEADER_MONEY: Array<[HeaderField, string]> = [["subtotal", "Subtotal"], ["tax", "Tax"], ["shipping", "Shipping"], ["discount", "Discount"], ["total", "Total"]];
const SYMBOLS: Array<[string, string[]]> = [["€", ["EUR"]], ["£", ["GBP"]], ["₹", ["INR"]], ["¥", ["JPY", "CNY"]], ["$", ["USD", "AUD", "CAD", "SGD", "NZD", "HKD", "MXN"]]];
const LOW_OCR = 0.6;
const SEVERITY_RANK: Record<Severity, number> = { blocking: 0, warning: 1, info: 2 };

const cents = (v: string | null): bigint => (v === null ? ZERO : toCents(v));
/** Drops trailing zeros from the fraction only, so "38.5000" reads "38.5" and "100" stays "100". */
const trim = (decimal: string): string => decimal.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

/** "subtotal", "subtotal and tax", "subtotal, tax and shipping". */
function listWords(words: string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function issue(code: string, severity: Severity, fieldPaths: string[], message: string, suggestion: Record<string, unknown> | null = null): IssueDraft {
  return { code, severity, fieldPaths, message, suggestion };
}

function lineAmounts(draft: InvoiceDraft): Array<{ idx: number; amount: string }> {
  return draft.lineItems.flatMap((li) => (li.amount === null ? [] : [{ idx: li.idx, amount: li.amount }]));
}

function v001(ctx: ValidationContext): IssueDraft[] {
  return REQUIRED.filter(([k]) => ctx.draft.header[k] === null).map(([k, label]) => issue("V001", "blocking", [k], `${label} is missing or could not be read.`));
}

function v002(ctx: ValidationContext): IssueDraft[] {
  const subtotal = ctx.draft.header.subtotal;
  const lines = lineAmounts(ctx.draft);
  if (subtotal === null || lines.length === 0) return [];
  const sum = lines.reduce((acc, l) => acc + toCents(l.amount), ZERO);
  const tolerance = BigInt(Math.max(5, lines.length));
  if (absCents(sum - toCents(subtotal)) <= tolerance) return [];
  let suggestion: CorrectionSuggestion | null = null;
  if (isAdjacentTransposition(subtotal, fromCents(sum))) {
    suggestion = { fieldPath: "subtotal", value: fromCents(sum), reason: "Two adjacent digits in the subtotal look swapped." };
  } else {
    for (const l of lines) {
      const needed = toCents(subtotal) - (sum - toCents(l.amount));
      if (needed > ZERO && isAdjacentTransposition(l.amount, fromCents(needed))) {
        suggestion = { fieldPath: `lineItems.${l.idx}.amount`, value: fromCents(needed), reason: `Two adjacent digits in line ${l.idx + 1} look swapped.` };
        break;
      }
    }
  }
  return [issue("V002", "blocking", ["subtotal", ...lines.map((l) => `lineItems.${l.idx}.amount`)], `The line items add up to ${fromCents(sum)} but the subtotal reads ${subtotal}.`, suggestion)];
}

function v003(ctx: ValidationContext): IssueDraft[] {
  const h = ctx.draft.header;
  if (h.total === null) return [];
  const lines = lineAmounts(ctx.draft);
  const lineSum = lines.reduce((acc, l) => acc + toCents(l.amount), ZERO);
  const base = h.subtotal ?? (lines.length ? fromCents(lineSum) : null);
  if (base === null) return [];
  // A discount prints either way round ("50.00" or "-50.00", which parseMoney reads as negative),
  // so its magnitude is what comes off the total.
  const expected = toCents(base) + cents(h.tax) + cents(h.shipping) - absCents(cents(h.discount));
  if (absCents(expected - toCents(h.total)) <= BigInt(5)) return [];
  const paths = [
    "total",
    ...(h.subtotal !== null ? ["subtotal"] : lines.map((l) => `lineItems.${l.idx}.amount`)),
    ...(h.tax !== null ? ["tax"] : []),
    ...(h.shipping !== null ? ["shipping"] : []),
    ...(h.discount !== null ? ["discount"] : []),
  ];
  let suggestion: CorrectionSuggestion | null = null;
  if (isAdjacentTransposition(h.total, fromCents(expected))) {
    suggestion = { fieldPath: "total", value: fromCents(expected), reason: "Two adjacent digits in the total look swapped." };
  } else if (h.tax === null && toCents(h.total) > expected) {
    suggestion = { fieldPath: "tax", value: fromCents(toCents(h.total) - expected), reason: "The difference looks like a tax amount that was not extracted." };
  }
  const basis = h.subtotal !== null ? "subtotal" : "line items";
  const named = [basis, ...(h.tax !== null ? ["tax"] : []), ...(h.shipping !== null ? ["shipping"] : []), ...(h.discount !== null ? ["discount"] : [])];
  // Naming only the amounts the invoice actually carries keeps the sentence true.
  const clause = named.length === 1 && basis === "subtotal" ? `The subtotal is ${fromCents(expected)}` : `The ${listWords(named)} add up to ${fromCents(expected)}`;
  return [issue("V003", "blocking", paths, `${clause} but the total reads ${h.total}.`, suggestion)];
}

function v004(ctx: ValidationContext): IssueDraft[] {
  return ctx.draft.lineItems.flatMap((li) => {
    if (li.quantity === null || li.unitPrice === null || li.amount === null) return [];
    const computed = mulToCents(li.quantity, li.unitPrice);
    if (absCents(computed - toCents(li.amount)) <= BigInt(2)) return [];
    const path = `lineItems.${li.idx}.amount`;
    return [
      issue("V004", "warning", [path, `lineItems.${li.idx}.quantity`, `lineItems.${li.idx}.unitPrice`], `Line ${li.idx + 1}: ${trim(li.quantity)} times ${trim(li.unitPrice)} is ${fromCents(computed)}, not ${li.amount}.`, {
        fieldPath: path,
        value: fromCents(computed),
        reason: "Quantity times unit price.",
      }),
    ];
  });
}

function v005(ctx: ValidationContext): IssueDraft[] {
  const { issueDate, dueDate } = ctx.draft.header;
  if (!issueDate || !dueDate || dueDate >= issueDate) return [];
  return [issue("V005", "warning", ["dueDate", "issueDate"], `The due date (${dueDate}) is before the issue date (${issueDate}).`)];
}

function v006(ctx: ValidationContext): IssueDraft[] {
  const { issueDate } = ctx.draft.header;
  if (!issueDate) return [];
  const now = ctx.now;
  const tenYearsAgo = new Date(Date.UTC(now.getUTCFullYear() - 10, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
  const thirtyDaysAhead = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  if (issueDate < tenYearsAgo) return [issue("V006", "warning", ["issueDate"], `The issue date (${issueDate}) is more than ten years ago.`)];
  if (issueDate > thirtyDaysAhead) return [issue("V006", "warning", ["issueDate"], `The issue date (${issueDate}) is more than 30 days in the future.`)];
  return [];
}

function v007(ctx: ValidationContext): IssueDraft[] {
  const code = ctx.draft.header.currency;
  if (!code) return [];
  const printed = HEADER_MONEY.map(([k]) => ctx.extraction.fields[k].sourceText ?? "").join(" ");
  const found = SYMBOLS.filter(([symbol]) => printed.includes(symbol));
  // Two different symbols across the header is a reading problem, not a currency we can propose.
  if (found.length !== 1) return [];
  const [symbol, codes] = found[0];
  if (codes.includes(code)) return [];
  return [issue("V007", "warning", ["currency"], `Amounts are printed with "${symbol}" but the currency reads ${code}.`, { fieldPath: "currency", value: codes[0], reason: "The symbol printed next to the amounts." })];
}

function v008(ctx: ValidationContext): IssueDraft[] {
  if (!ctx.duplicate) return [];
  return [issue("V008", "warning", ["invoiceNumber", "vendorName"], `Another document in this workspace has the same vendor and invoice number: ${ctx.duplicate.filename}.`, { kind: "duplicate", ...ctx.duplicate })];
}

function v009(ctx: ValidationContext): IssueDraft[] {
  const total = ctx.draft.header.total;
  if (total === null || toCents(total) >= ZERO) return [];
  return [issue("V009", "info", ["total"], `The total is negative (${total}). This may be a credit note.`)];
}

function v010(ctx: ValidationContext): IssueDraft[] {
  const out: IssueDraft[] = [];
  for (const [k, label] of HEADER_MONEY) {
    const value = ctx.draft.header[k];
    if (value !== null && !ctx.grounding[k]) out.push(issue("V010", "blocking", [k], `${label} (${value}) could not be found on the document.`));
  }
  for (const li of ctx.draft.lineItems) {
    const path = `lineItems.${li.idx}.amount`;
    if (li.amount !== null && !ctx.grounding[path]) out.push(issue("V010", "warning", [path], `Line ${li.idx + 1} amount (${li.amount}) could not be found on the document.`));
  }
  return out;
}

function v012(ctx: ValidationContext): IssueDraft[] {
  return ctx.pages.flatMap((p) => {
    const confidence = p.ocrMeanConfidence;
    // Only a measured confidence warns: a page OCR never scored says nothing about its text.
    if (p.textSource !== "ocr" || confidence === null || confidence >= LOW_OCR) return [];
    return [issue("V012", "warning", [], `Text on page ${p.pageNo} was read by OCR with low confidence (${Math.round(confidence * 100)}%). Check values from this page carefully.`)];
  });
}

/** Runs every rule. V011 (not an invoice) is raised by the extract stage, which rejects the document. */
export function validateInvoice(ctx: ValidationContext): IssueDraft[] {
  const issues = [v001, v002, v003, v004, v005, v006, v007, v008, v009, v010, v012].flatMap((rule) => rule(ctx));
  return issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.code.localeCompare(b.code));
}
