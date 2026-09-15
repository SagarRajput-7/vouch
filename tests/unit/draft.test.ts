import { describe, expect, it } from "vitest";
import { buildInvoice, fieldMetaFrom, searchTextFor } from "@/lib/pipeline/draft";
import type { ExtractionResult } from "@/lib/pipeline/extract/schema";
import type { Grounding } from "@/lib/pipeline/types";

const g: Grounding = { page: 2, bbox: [0.1, 0.2, 0.3, 0.02], groundingScore: 0.9, groundingMethod: "normalized", matchedText: "1,764.48", line: 4, range: [10, 11] };

describe("fieldMetaFrom", () => {
  it("copies location and method from grounding and keeps risk low for a clean grounded field", () => {
    const meta = fieldMetaFrom("total", { value: "1764.48", sourceText: "1,764.48", page: 1, confidence: 0.95 }, g, { blocking: 0, warning: 0 });
    expect(meta).toMatchObject({ page: 2, bbox: [0.1, 0.2, 0.3, 0.02], groundingScore: 0.9, groundingMethod: "normalized", status: "pending" });
    expect(meta.risk).toBeLessThan(0.2);
  });
  it("is high risk when a money field is ungrounded or carries a blocking issue", () => {
    expect(fieldMetaFrom("total", { value: "1764.48", sourceText: null, page: 1, confidence: 0.95 }, null, { blocking: 0, warning: 0 }).risk).toBeGreaterThanOrEqual(0.5);
    expect(fieldMetaFrom("total", { value: "1764.48", sourceText: null, page: 1, confidence: 0.95 }, g, { blocking: 1, warning: 0 }).risk).toBeGreaterThanOrEqual(0.5);
  });
  it("scores a missing total as high risk and a missing issue date as only medium", () => {
    const missing = { value: null, sourceText: null, page: null, confidence: 0.9 };
    expect(fieldMetaFrom("total", missing, null, { blocking: 1, warning: 0 }).risk).toBeGreaterThanOrEqual(0.5);
    const dateRisk = fieldMetaFrom("issueDate", missing, null, { blocking: 1, warning: 0 }).risk;
    expect(dateRisk).toBeGreaterThanOrEqual(0.2);
    expect(dateRisk).toBeLessThan(0.5);
  });
  it("treats an absent optional value as nothing to locate", () => {
    const meta = fieldMetaFrom("shipping", { value: null, sourceText: null, page: null, confidence: 0.9 }, null, { blocking: 0, warning: 0 });
    expect(meta.groundingMethod).toBe("none");
    expect(meta.risk).toBeLessThan(0.2);
  });
});

describe("buildInvoice with grounding and issues", () => {
  const scalar = (value: string | null) => ({ value, sourceText: value, page: 1, confidence: 0.9 });
  const extraction: ExtractionResult = {
    docType: { value: "invoice", confidence: 0.9, reason: "" },
    fields: { vendorName: scalar("Acme GmbH"), invoiceNumber: scalar("A-1"), issueDate: scalar("2026-01-02"), dueDate: scalar(null), currency: scalar("eur"), subtotal: scalar("10.00"), tax: scalar("1.90"), shipping: scalar(null), discount: scalar(null), total: scalar("11.90") },
    lineItems: [{ description: scalar("Widget"), quantity: scalar("2"), unitPrice: scalar("5.00"), amount: scalar("10.00") }],
    notes: null,
  };
  const everywhere = Object.fromEntries(
    ["vendorName", "invoiceNumber", "issueDate", "currency", "subtotal", "tax", "total", "lineItems.0.description", "lineItems.0.quantity", "lineItems.0.unitPrice", "lineItems.0.amount"].map((k) => [k, g]),
  );
  it("attaches per-field issue counts and grounding", () => {
    const built = buildInvoice(extraction, {
      grounding: everywhere,
      issues: [{ code: "V003", severity: "blocking", fieldPaths: ["total", "subtotal"], message: "", suggestion: null }, { code: "V004", severity: "warning", fieldPaths: ["lineItems.0.amount"], message: "", suggestion: null }],
    });
    expect(built.fields.total.bbox).toEqual(g.bbox);
    expect(built.fields.total.risk).toBeGreaterThanOrEqual(0.5);
    expect(built.fields.subtotal.risk).toBeGreaterThanOrEqual(0.5);
    expect(built.fields.vendorName.risk).toBeLessThan(0.2);
    expect(built.fields.dueDate.groundingMethod).toBe("none");
    const amount = built.lineItems[0].meta.amount!.risk;
    expect(amount).toBeGreaterThanOrEqual(0.2);
    expect(amount).toBeLessThan(0.5);
    expect(built.lineItems[0].meta.description!.risk).toBeLessThan(0.2);
    expect(built.header.currency).toBe("EUR");
    expect(built.lineItems[0].quantity).toBe("2.0000");
  });
  it("builds a search text from the identifying strings and descriptions", () => {
    expect(searchTextFor(buildInvoice(extraction))).toBe("Acme GmbH A-1 EUR Widget");
  });
});
