import { describe, expect, it } from "vitest";
import { candidatesFor, fuzzyKey, isMoneyShaped, normalizeText, normalizeWords } from "@/lib/pipeline/ground/normalize";

describe("normalizeText", () => {
  it("canonicalises amounts in any grouping, and leaves bare numbers alone", () => {
    expect(normalizeText("1,630.00")).toBe("1630.00");
    expect(normalizeText("1.190,00")).toBe("1190.00");
    expect(normalizeText("10,17,810.00")).toBe("1017810.00");
    expect(normalizeText("$1,764.48")).toBe("1764.48");
    expect(normalizeText("12")).toBe("12");
  });
  it("only treats a number as money when it is printed as an amount", () => {
    expect(isMoneyShaped("1,630.00")).toBe(true);
    expect(isMoneyShaped("2,160")).toBe(true);
    expect(isMoneyShaped("$1764")).toBe(true);
    expect(isMoneyShaped("2026")).toBe(false);
    expect(isMoneyShaped("4471")).toBe(false);
    expect(isMoneyShaped("5%")).toBe(false);
    expect(isMoneyShaped("Total")).toBe(false);
    // A year, a reference number and a day of the month keep their own digits.
    expect(normalizeText("2026")).toBe("2026");
    expect(normalizeText("4471")).toBe("4471");
    expect(normalizeText("5%")).toBe("5");
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
    expect(normalizeWords("Aug 3, 2026")).toBe("aug 3 2026");
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
  it("drops a source text that reads as a different amount or day", () => {
    // The page shows 719.70; the model claims 791.70. Searching for the source text would locate
    // a value the page does not carry, so only the value itself is searched for.
    const transposed = candidatesFor("money", { value: "791.70", sourceText: "719.70" });
    expect(transposed.map((c) => c.raw)).toEqual(["791.70"]);
    expect(candidatesFor("number", { value: "2160", sourceText: "2,160" }).map((c) => c.raw)).toEqual(["2,160", "2160"]);
    expect(candidatesFor("number", { value: "2160", sourceText: "2,161" }).map((c) => c.raw)).toEqual(["2160"]);
    expect(candidatesFor("date", { value: "2026-08-03", sourceText: "Aug 4, 2026" }).map((c) => c.raw)).toEqual(["2026-08-03"]);
  });
  it("keeps a source text that is the same value written differently", () => {
    expect(candidatesFor("money", { value: "1764.48", sourceText: "USD 1,764.48" }).map((c) => c.raw)).toEqual(["USD 1,764.48", "1764.48"]);
    expect(candidatesFor("date", { value: "2026-08-03", sourceText: "Aug 3, 2026" }).map((c) => c.raw)).toEqual(["Aug 3, 2026", "2026-08-03"]);
    // Case, punctuation and word order legitimately differ for text and currency.
    expect(candidatesFor("text", { value: "Halcyon Cloud Services Inc.", sourceText: "HALCYON CLOUD SERVICES INC" }).map((c) => c.raw)).toHaveLength(2);
    expect(candidatesFor("currency", { value: "USD", sourceText: "$" }).map((c) => c.raw)).toEqual(["$", "USD"]);
  });
  it("skips empty strings and nulls", () => {
    expect(candidatesFor("text", { value: null, sourceText: "  " })).toEqual([]);
  });
});
