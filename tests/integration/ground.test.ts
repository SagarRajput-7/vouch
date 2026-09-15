import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { groundTruthSchema } from "@/lib/pipeline/extract/ground-truth";
import { groundTruthToExtraction } from "@/lib/pipeline/extract/mock-provider";
import { countValues, groundExtraction } from "@/lib/pipeline/ground/extraction";
import { PARSE_LIMITS } from "@/lib/pipeline/parse/limits";
import { extractPdfText } from "@/lib/pipeline/parse/pdf-text";

async function load(name: string) {
  const bytes = new Uint8Array(await readFile(path.resolve("samples/out", `${name}.pdf`)));
  const gt = groundTruthSchema.parse(JSON.parse(await readFile(path.resolve("samples/ground-truth", `${name}.json`), "utf8")));
  const { pages } = await extractPdfText(bytes, PARSE_LIMITS.maxPages, PARSE_LIMITS.minTextTokens);
  const extraction = groundTruthToExtraction(gt);
  return { pages, extraction, grounding: groundExtraction(extraction, pages) };
}

describe("grounding on real PDF tokens", () => {
  it("locates every value of the clean sample, with the total below the heading", async () => {
    const { extraction, grounding } = await load("clean-digital");
    const grounded = Object.values(grounding).filter(Boolean);
    expect(grounded).toHaveLength(countValues(extraction));
    expect(grounding.total).toMatchObject({ page: 1, groundingMethod: "exact", matchedText: "1,764.48" });
    expect(grounding.vendorName).toMatchObject({ groundingMethod: "exact" });
    // y grows downward, so the total sits below the vendor heading.
    expect(grounding.total!.bbox[1]).toBeGreaterThan(grounding.vendorName!.bbox[1] + 0.1);
    expect(grounding.issueDate).toMatchObject({ matchedText: "Aug 3, 2026" });
    expect(grounding["lineItems.1.quantity"]!.line).toBe(grounding["lineItems.1.description"]!.line);
  });

  it("keeps identical unit price and amount on one row apart", async () => {
    const { grounding } = await load("mismatch-total");
    const unit = grounding["lineItems.2.unitPrice"]!;
    const amount = grounding["lineItems.2.amount"]!;
    expect(unit.line).toBe(amount.line);
    expect(unit.range[0]).toBeLessThan(amount.range[0]);
    expect(grounding.total).toMatchObject({ matchedText: "719.70" });
  });

  it("grounds every value of the German sample through its locale", async () => {
    const { extraction, grounding } = await load("euro-format");
    const grounded = Object.values(grounding).filter(Boolean).length;
    expect(grounded).toBe(countValues(extraction));
    // Dot thousands, decimal commas, a euro sign in its own token and day-first dotted dates.
    expect(grounding.total).toMatchObject({ page: 1, groundingMethod: "exact", matchedText: "1.190,00 €" });
    expect(grounding.subtotal).toMatchObject({ matchedText: "1.000,00 €" });
    expect(grounding.issueDate).toMatchObject({ matchedText: "03.08.2026" });
    expect(grounding["lineItems.0.unitPrice"]).toMatchObject({ matchedText: "185,50" });
    // The printed currency is bracketed; normalisation still reaches it.
    expect(grounding.currency).toMatchObject({ groundingMethod: "normalized", matchedText: "(EUR)" });
  });

  it("grounds every value of the injection sample on what the page prints", async () => {
    const { extraction, grounding } = await load("injection");
    const grounded = Object.values(grounding).filter(Boolean).length;
    expect(grounded).toBe(countValues(extraction));
    // The page carries an instruction to zero the total and date it 2020; grounding follows the print.
    expect(grounding.total).toMatchObject({ page: 1, groundingMethod: "exact", matchedText: "USD 1,749.60" });
    expect(grounding.dueDate).toMatchObject({ matchedText: "15 September 2026" });
    expect(grounding["lineItems.0.amount"]).toMatchObject({ matchedText: "1,500.00" });
  });

  it("follows values across pages and lakh grouping", async () => {
    const { extraction, grounding } = await load("multipage-lineitems");
    expect(grounding.total).toMatchObject({ page: 3, matchedText: "12,01,015.80" });
    expect(grounding["lineItems.0.description"]!.page).toBe(1);
    expect(grounding["lineItems.12.description"]!.page).toBe(2);
    expect(grounding["lineItems.21.amount"]).toMatchObject({ page: 3, matchedText: "1,44,000.00" });
    const grounded = Object.values(grounding).filter(Boolean).length;
    expect(grounded).toBe(countValues(extraction));
  });
});
