import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildInvoice } from "@/lib/pipeline/draft";
import { groundTruthSchema } from "@/lib/pipeline/extract/ground-truth";
import { groundTruthToExtraction } from "@/lib/pipeline/extract/mock-provider";
import type { ExtractionResult } from "@/lib/pipeline/extract/schema";
import { fieldNames } from "@/lib/pipeline/extract/schema";
import type { GroundingMap } from "@/lib/pipeline/ground/extraction";
import type { Grounding, ParsedPage } from "@/lib/pipeline/types";
import { validateInvoice, type ValidationContext } from "@/lib/pipeline/validate/rules";

const NOW = new Date("2026-09-15T12:00:00Z");
const grounded: Grounding = { page: 1, bbox: [0, 0, 0.1, 0.02], groundingScore: 1, groundingMethod: "exact", matchedText: "", line: 0, range: [0, 1] };
const textPage: ParsedPage = { pageNo: 1, width: 600, height: 800, rotation: 0, textSource: "pdf", ocrMeanConfidence: null, tokens: [] };

function fullyGrounded(e: ExtractionResult): GroundingMap {
  const g: GroundingMap = {};
  for (const f of fieldNames) g[f] = e.fields[f].value === null ? null : grounded;
  e.lineItems.forEach((li, i) => {
    for (const c of ["description", "quantity", "unitPrice", "amount"] as const) g[`lineItems.${i}.${c}`] = li[c].value === null ? null : grounded;
  });
  return g;
}

function sample(name: string): ExtractionResult {
  return groundTruthToExtraction(groundTruthSchema.parse(JSON.parse(readFileSync(path.resolve("samples/ground-truth", `${name}.json`), "utf8"))));
}

function ctx(extraction: ExtractionResult, overrides: Partial<ValidationContext> = {}): ValidationContext {
  return { draft: buildInvoice(extraction), extraction, grounding: fullyGrounded(extraction), pages: [textPage], duplicate: null, now: NOW, ...overrides };
}

const codes = (issues: ReturnType<typeof validateInvoice>) => issues.map((i) => i.code);

describe("validateInvoice", () => {
  it("passes a clean invoice with no issues", () => {
    expect(validateInvoice(ctx(sample("clean-digital")))).toEqual([]);
  });

  it("V001 flags each missing required field", () => {
    const e = sample("clean-digital");
    e.fields.total = { value: null, sourceText: null, page: null, confidence: 0.5 };
    e.fields.currency = { value: null, sourceText: null, page: null, confidence: 0.5 };
    const issues = validateInvoice(ctx(e));
    expect(issues.filter((i) => i.code === "V001").map((i) => i.fieldPaths)).toEqual([["currency"], ["total"]]);
    expect(issues[0].severity).toBe("blocking");
    expect(issues.find((i) => i.fieldPaths[0] === "total")?.message).toBe("Total is missing or could not be read.");
  });

  it("V001 quotes the printed text when a value was read but could not be parsed", () => {
    const e = sample("clean-digital");
    // The model saw a date and reported it; only its own ISO value is unusable.
    e.fields.issueDate = { value: "2026/13/01", sourceText: "13/01/2026", page: 1, confidence: 0.4 };
    const issues = validateInvoice(ctx(e)).filter((i) => i.code === "V001");
    expect(issues.map((i) => i.message)).toEqual(["Issue date could not be read as a date (printed as 2026/13/01)."]);
  });

  it("V003 catches the mismatch sample and suggests the transposed total", () => {
    const issues = validateInvoice(ctx(sample("mismatch-total")));
    expect(codes(issues)).toEqual(["V003"]);
    expect(issues[0]).toMatchObject({ severity: "blocking", suggestion: { fieldPath: "total", value: "791.70" } });
    expect(issues[0].fieldPaths).toEqual(["total", "subtotal", "tax"]);
    expect(issues[0].message).toBe("The subtotal and tax add up to 791.70 but the total reads 719.70.");
  });

  it("V003 proposes a missing tax when nothing else explains the difference", () => {
    const e = sample("clean-digital");
    e.fields.tax = { value: null, sourceText: null, page: null, confidence: 0.5 };
    const issues = validateInvoice(ctx(e));
    expect(issues.find((i) => i.code === "V003")?.suggestion).toEqual({ fieldPath: "tax", value: "134.48", reason: expect.stringContaining("tax") });
  });

  it("V003 subtracts a discount however its sign is printed", () => {
    for (const discount of ["-50.00", "50.00"]) {
      const e = sample("clean-digital");
      e.fields.subtotal = { value: "1000.00", sourceText: "1,000.00", page: 1, confidence: 0.9 };
      e.fields.tax = { value: null, sourceText: null, page: null, confidence: 0.9 };
      e.fields.discount = { value: discount, sourceText: discount, page: 1, confidence: 0.9 };
      e.fields.total = { value: "950.00", sourceText: "950.00", page: 1, confidence: 0.9 };
      e.lineItems = [];
      expect(codes(validateInvoice(ctx(e)))).not.toContain("V003");
    }
  });

  it("V002 checks the line sum against the subtotal with a swap suggestion", () => {
    const e = sample("mismatch-total");
    e.fields.subtotal = { value: "745.00", sourceText: "745.00", page: 1, confidence: 0.9 };
    e.fields.total = { value: "782.70", sourceText: "782.70", page: 1, confidence: 0.9 };
    const issues = validateInvoice(ctx(e));
    const v002 = issues.find((i) => i.code === "V002")!;
    expect(v002.severity).toBe("blocking");
    expect(v002.suggestion).toMatchObject({ fieldPath: "subtotal", value: "754.00" });
    expect(v002.fieldPaths).toContain("lineItems.2.amount");
  });

  it("V002 points at the line whose digits are swapped when the subtotal is right", () => {
    const e = sample("mismatch-total");
    e.lineItems[0].amount = { value: "426.00", sourceText: "426.00", page: 1, confidence: 0.9 };
    const v002 = validateInvoice(ctx(e)).find((i) => i.code === "V002")!;
    expect(v002.suggestion).toMatchObject({ fieldPath: "lineItems.0.amount", value: "462.00" });
  });

  it("V004 warns on a line whose quantity times price is off", () => {
    const e = sample("mismatch-total");
    e.lineItems[0].amount = { value: "426.00", sourceText: "426.00", page: 1, confidence: 0.9 };
    const issues = validateInvoice(ctx(e));
    const v004 = issues.find((i) => i.code === "V004")!;
    expect(v004).toMatchObject({ severity: "warning", suggestion: { fieldPath: "lineItems.0.amount", value: "462.00" } });
  });

  it("V004 stays quiet on a metered line priced below a cent", () => {
    const e = sample("clean-digital");
    e.fields.subtotal = { value: "500.00", sourceText: "500.00", page: 1, confidence: 0.9 };
    e.fields.tax = { value: null, sourceText: null, page: null, confidence: 0.9 };
    e.fields.total = { value: "500.00", sourceText: "500.00", page: 1, confidence: 0.9 };
    e.lineItems = [
      {
        description: { value: "API calls, August 2026", sourceText: "API calls, August 2026", page: 1, confidence: 0.9 },
        quantity: { value: "40000", sourceText: "40,000", page: 1, confidence: 0.9 },
        unitPrice: { value: "0.0125", sourceText: "0.0125", page: 1, confidence: 0.9 },
        amount: { value: "500.00", sourceText: "500.00", page: 1, confidence: 0.9 },
      },
    ];
    expect(validateInvoice(ctx(e))).toEqual([]);
  });

  it("V005 and V006 check date order and range", () => {
    const e = sample("clean-digital");
    e.fields.dueDate = { value: "2026-08-01", sourceText: "Aug 1, 2026", page: 1, confidence: 0.9 };
    expect(codes(validateInvoice(ctx(e)))).toContain("V005");
    e.fields.dueDate = { value: "2012-09-01", sourceText: null, page: 1, confidence: 0.9 };
    e.fields.issueDate = { value: "2012-08-03", sourceText: null, page: 1, confidence: 0.9 };
    expect(codes(validateInvoice(ctx(e)))).toContain("V006");
    e.fields.issueDate = { value: "2026-11-30", sourceText: null, page: 1, confidence: 0.9 };
    e.fields.dueDate = { value: "2026-12-30", sourceText: null, page: 1, confidence: 0.9 };
    expect(codes(validateInvoice(ctx(e)))).toContain("V006");
  });

  it("V007 flags a symbol that contradicts the currency code", () => {
    const e = sample("euro-format");
    e.fields.currency = { value: "USD", sourceText: "USD", page: 1, confidence: 0.6 };
    const issues = validateInvoice(ctx(e));
    expect(issues.find((i) => i.code === "V007")).toMatchObject({ severity: "warning", suggestion: { fieldPath: "currency", value: "EUR" } });
    const aud = sample("scan-lowres");
    aud.fields.total = { value: "280.50", sourceText: "$280.50", page: 1, confidence: 0.9 };
    expect(codes(validateInvoice(ctx(aud)))).not.toContain("V007");
  });

  it("V007 stays quiet when the header mixes currency symbols", () => {
    const e = sample("euro-format");
    e.fields.currency = { value: "USD", sourceText: "USD", page: 1, confidence: 0.6 };
    e.fields.subtotal = { value: "1000.00", sourceText: "$1.000,00", page: 1, confidence: 0.9 };
    expect(codes(validateInvoice(ctx(e)))).not.toContain("V007");
  });

  it("V008 links a duplicate", () => {
    const issues = validateInvoice(ctx(sample("clean-digital"), { duplicate: { documentId: "d2", filename: "again.pdf" } }));
    expect(issues.find((i) => i.code === "V008")).toMatchObject({ severity: "warning", fieldPaths: ["invoiceNumber", "vendorName"], suggestion: { kind: "duplicate", documentId: "d2", filename: "again.pdf" } });
  });

  it("V009 marks a negative total as informational", () => {
    const e = sample("clean-digital");
    e.fields.total = { value: "-1764.48", sourceText: "-1,764.48", page: 1, confidence: 0.9 };
    e.fields.subtotal = { value: "-1630.00", sourceText: null, page: 1, confidence: 0.9 };
    e.fields.tax = { value: "-134.48", sourceText: null, page: 1, confidence: 0.9 };
    e.lineItems = [];
    const issues = validateInvoice(ctx(e));
    expect(issues.find((i) => i.code === "V009")?.severity).toBe("info");
  });

  it("V010 blocks on an ungrounded header amount and warns on an ungrounded line amount", () => {
    const e = sample("clean-digital");
    const grounding = fullyGrounded(e);
    grounding.total = null;
    grounding["lineItems.1.amount"] = null;
    const issues = validateInvoice(ctx(e, { grounding }));
    expect(issues.filter((i) => i.code === "V010").map((i) => [i.severity, i.fieldPaths[0]])).toEqual([["blocking", "total"], ["warning", "lineItems.1.amount"]]);
  });

  it("V012 warns per low-confidence OCR page", () => {
    const pages: ParsedPage[] = [{ ...textPage, textSource: "ocr", ocrMeanConfidence: 0.45 }, { ...textPage, pageNo: 2, textSource: "ocr", ocrMeanConfidence: 0.9 }];
    const issues = validateInvoice(ctx(sample("clean-digital"), { pages }));
    expect(issues.filter((i) => i.code === "V012")).toHaveLength(1);
    expect(issues[0].message).toContain("page 1");
  });

  it("V012 raises nothing for an OCR page with no measured confidence", () => {
    const pages: ParsedPage[] = [{ ...textPage, textSource: "ocr", ocrMeanConfidence: null }];
    const issues = validateInvoice(ctx(sample("clean-digital"), { pages }));
    expect(issues.filter((i) => i.code === "V012")).toHaveLength(0);
  });

  it("orders blocking before warning before info", () => {
    const e = sample("mismatch-total");
    e.fields.dueDate = { value: "2026-07-01", sourceText: null, page: 1, confidence: 0.9 };
    const issues = validateInvoice(ctx(e));
    expect(issues.map((i) => i.severity)).toEqual(["blocking", "warning"]);
  });
});
