import { describe, expect, it } from "vitest";
import type { PositionedToken } from "@/lib/db/schema";
import { groundExtraction } from "@/lib/pipeline/ground/extraction";
import { groundValue } from "@/lib/pipeline/ground/match";
import { candidatesFor } from "@/lib/pipeline/ground/normalize";
import type { ExtractionResult } from "@/lib/pipeline/extract/schema";
import type { ParsedPage } from "@/lib/pipeline/types";

/** One token per whitespace-separated word; x by word index, y by line index. */
function makePage(pageNo: number, lines: string[]): ParsedPage {
  const tokens: PositionedToken[] = [];
  lines.forEach((line, li) => {
    line.split(" ").forEach((text, xi) => tokens.push({ text, x: xi * 0.1, y: li * 0.05, w: 0.08, h: 0.02, line: li }));
  });
  return { pageNo, width: 600, height: 800, rotation: 0, textSource: "pdf", ocrMeanConfidence: null, tokens };
}

const money = (value: string, sourceText: string | null = null) => candidatesFor("money", { value, sourceText });
const text = (value: string, sourceText: string | null = null) => candidatesFor("text", { value, sourceText });
const base = { preferredPage: 1, labels: [] as string[] };

describe("groundValue", () => {
  it("matches a single token exactly with its box", () => {
    const page = makePage(1, ["Halcyon Cloud Services Inc.", "Total 1,764.48"]);
    const g = groundValue(money("1764.48", "1,764.48"), [page], base)!;
    expect(g).toMatchObject({ page: 1, groundingScore: 1, groundingMethod: "exact", matchedText: "1,764.48", line: 1, range: [5, 6] });
    expect(g.bbox).toEqual([0.1, 0.05, 0.08, 0.02]);
  });

  it("matches formatting variants through normalisation", () => {
    const page = makePage(1, ["Subtotal 1,630.00", "Gesamtbetrag 1.190,00", "Total 10,17,810.00"]);
    expect(groundValue(money("1630.00"), [page], base)).toMatchObject({ groundingScore: 0.9, groundingMethod: "normalized", matchedText: "1,630.00" });
    expect(groundValue(money("1190.00"), [page], base)).toMatchObject({ groundingMethod: "normalized", matchedText: "1.190,00" });
    expect(groundValue(money("1017810.00"), [page], base)).toMatchObject({ groundingMethod: "normalized", matchedText: "10,17,810.00", line: 2 });
  });

  it("matches printed dates against ISO values", () => {
    const page = makePage(1, ["Invoice date: 21/07/2026", "Date Aug 3, 2026"]);
    expect(groundValue(candidatesFor("date", { value: "2026-07-21", sourceText: null }), [page], base)).toMatchObject({ groundingMethod: "normalized", matchedText: "21/07/2026" });
    expect(groundValue(candidatesFor("date", { value: "2026-08-03", sourceText: "Aug 3, 2026" }), [page], base)).toMatchObject({ groundingMethod: "exact", matchedText: "Aug 3, 2026", range: [4, 7] });
  });

  it("tolerates OCR noise with a fuzzy match", () => {
    const page = makePage(1, ["Total 1,764.4B"]);
    const g = groundValue(money("1764.48", "1,764.48"), [page], base)!;
    expect(g.groundingMethod).toBe("fuzzy");
    expect(g.groundingScore).toBeCloseTo(0.875 * 0.8, 3);
    expect(g.matchedText).toBe("1,764.4B");
  });

  it("separates repeated values by label proximity", () => {
    const page = makePage(1, ["Delivery charge 1 25.00 25.00", "Subtotal 754.00", "Shipping 25.00", "Total 779.00"]);
    const g = groundValue(money("25.00"), [page], { preferredPage: 1, labels: ["shipping", "freight"] })!;
    expect(g.line).toBe(2);
  });

  it("prefers the page the model named, else the first page", () => {
    const p1 = makePage(1, ["Total 500.00"]);
    const p2 = makePage(2, ["Total 500.00"]);
    expect(groundValue(money("500.00"), [p1, p2], { preferredPage: 2, labels: [] })!.page).toBe(2);
    expect(groundValue(money("500.00"), [p1, p2], { preferredPage: null, labels: [] })!.page).toBe(1);
  });

  it("returns null when nothing is close enough", () => {
    const page = makePage(1, ["Total 500.00"]);
    expect(groundValue(money("123.45"), [page], base)).toBeNull();
    expect(groundValue(text("Completely different vendor"), [page], base)).toBeNull();
  });

  it("matches multi-token windows and unions their boxes", () => {
    const page = makePage(1, ["Amount due USD 1,764.48 today"]);
    const g = groundValue(money("1764.48", "USD 1,764.48"), [page], base)!;
    expect(g).toMatchObject({ groundingMethod: "exact", matchedText: "USD 1,764.48", range: [2, 4] });
    expect(g.bbox).toEqual([0.2, 0, 0.18, 0.02]);
  });

  it("skips excluded ranges and honours the column hint", () => {
    const page = makePage(1, ["Delivery 1 25.00 25.00"]);
    const first = groundValue(money("25.00"), [page], { ...base, columnHint: "left" })!;
    expect(first.range).toEqual([2, 3]);
    const second = groundValue(money("25.00"), [page], { ...base, exclude: [{ page: 1, start: 2, end: 3 }], columnHint: "right" })!;
    expect(second.range).toEqual([3, 4]);
  });

  it("keeps line-item cells on the row of their description", () => {
    const page = makePage(1, ["Additional seats 4 45.00 180.00", "Priority support 1 45.00 45.00"]);
    const g = groundValue(money("45.00"), [page], { preferredPage: 1, labels: [], nearLine: { page: 1, line: 1 } })!;
    expect(g.line).toBe(1);
  });
});

describe("groundExtraction", () => {
  const scalar = (value: string | null, sourceText: string | null = value) => ({ value, sourceText, page: 1, confidence: 0.9 });
  const extraction: ExtractionResult = {
    docType: { value: "invoice", confidence: 0.9, reason: "" },
    fields: {
      vendorName: scalar("Meridian Office Supplies Ltd."),
      invoiceNumber: scalar("MOS/INV/88213"),
      issueDate: scalar("2026-07-21", "21/07/2026"),
      dueDate: scalar(null),
      currency: scalar("USD"),
      subtotal: scalar("754.00"),
      tax: scalar("37.70"),
      shipping: scalar(null),
      discount: scalar(null),
      total: scalar("719.70"),
    },
    lineItems: [
      { description: scalar("Toner cartridge TN-2420"), quantity: scalar("3"), unitPrice: scalar("89.00"), amount: scalar("267.00") },
      { description: scalar("Delivery"), quantity: scalar("1"), unitPrice: scalar("25.00"), amount: scalar("25.00") },
    ],
    notes: null,
  };
  const page = makePage(1, [
    "Meridian Office Supplies Ltd.",
    "No. MOS/INV/88213 Invoice date: 21/07/2026",
    "Toner cartridge TN-2420 3 89.00 267.00",
    "Delivery 1 25.00 25.00",
    "Net amount 754.00",
    "VAT 5% 37.70",
    "Amount payable 719.70",
    "All amounts in USD.",
  ]);

  it("grounds header fields and line-item cells by path, leaving null values null", () => {
    const g = groundExtraction(extraction, [page]);
    expect(g.vendorName).toMatchObject({ groundingMethod: "exact", line: 0 });
    expect(g.invoiceNumber).toMatchObject({ groundingMethod: "exact", line: 1 });
    expect(g.issueDate).toMatchObject({ groundingMethod: "exact", matchedText: "21/07/2026" });
    expect(g.dueDate).toBeNull();
    expect(g.shipping).toBeNull();
    expect(g.total).toMatchObject({ line: 6 });
    expect(g.currency).toMatchObject({ matchedText: "USD." });
    expect(g["lineItems.0.description"]).toMatchObject({ line: 2 });
    // Token indexes are page-wide: line 0 holds 0..3, line 1 holds 4..8, line 2 holds 9..14, line 3 holds 15..18.
    expect(g["lineItems.0.quantity"]).toMatchObject({ line: 2, range: [12, 13] });
    expect(g["lineItems.1.unitPrice"]).toMatchObject({ line: 3, range: [17, 18] });
    expect(g["lineItems.1.amount"]).toMatchObject({ line: 3, range: [18, 19] });
    expect(Object.keys(g)).toHaveLength(10 + 2 * 4);
  });
});
