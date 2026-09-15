import { describe, expect, it } from "vitest";
import { candidatesFor, fuzzyKey, normalizeText, normalizeWords } from "@/lib/pipeline/ground/normalize";

describe("normalizeText", () => {
  it("canonicalises numbers in any grouping", () => {
    expect(normalizeText("1,630.00")).toBe("1630.00");
    expect(normalizeText("1.190,00")).toBe("1190.00");
    expect(normalizeText("10,17,810.00")).toBe("1017810.00");
    expect(normalizeText("$1,764.48")).toBe("1764.48");
    expect(normalizeText("12")).toBe("12.00");
  });
  it("lowercases text, drops punctuation and currency symbols, keeps letters and digits", () => {
    expect(normalizeText("Inc.")).toBe("inc");
    expect(normalizeText("HCS-2026-0417")).toBe("hcs 2026 0417");
    expect(normalizeText("€")).toBe("");
    expect(normalizeText("USD")).toBe("usd");
    expect(normalizeText("Präzisionsfräser")).toBe("präzisionsfräser");
  });
  it("normalizeWords joins normalised words with single spaces", () => {
    expect(normalizeWords("USD  1,764.48")).toBe("usd 1764.48");
    expect(normalizeWords("Aug 3, 2026")).toBe("aug 3.00 2026.00");
  });
  it("fuzzyKey strips whitespace and currency marks only", () => {
    expect(fuzzyKey("USD 1,764.48")).toBe("1,764.48");
    expect(fuzzyKey("Halcyon Cloud")).toBe("halcyoncloud");
  });
});

describe("candidatesFor", () => {
  it("yields the source text first, then the value, without duplicates", () => {
    const c = candidatesFor("money", { value: "1764.48", sourceText: "USD 1,764.48" });
    expect(c.map((x) => x.raw)).toEqual(["USD 1,764.48", "1764.48"]);
    expect(c[0].money).toBe("1764.48");
    expect(c[0].words).toBe(2);
  });
  it("attaches the ISO date for date fields", () => {
    const c = candidatesFor("date", { value: "2026-08-03", sourceText: "Aug 3, 2026" });
    expect(c[0].iso).toBe("2026-08-03");
    expect(c[1].iso).toBe("2026-08-03");
  });
  it("skips empty strings and nulls", () => {
    expect(candidatesFor("text", { value: null, sourceText: "  " })).toEqual([]);
  });
});
