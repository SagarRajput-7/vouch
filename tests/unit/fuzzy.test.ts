import { describe, expect, it } from "vitest";
import { damerauLevenshtein, similarity } from "@/lib/pipeline/ground/fuzzy";

describe("damerauLevenshtein", () => {
  it("counts insertions, deletions, substitutions and adjacent swaps", () => {
    expect(damerauLevenshtein("", "abc")).toBe(3);
    expect(damerauLevenshtein("kitten", "sitting")).toBe(3);
    expect(damerauLevenshtein("1764.48", "1764.4B")).toBe(1);
    expect(damerauLevenshtein("ab", "ba")).toBe(1);
    expect(damerauLevenshtein("same", "same")).toBe(0);
  });
  it("similarity is 1 minus distance over the longer length", () => {
    expect(similarity("1,764.48", "1,764.4B")).toBeCloseTo(0.875, 5);
    expect(similarity("", "")).toBe(1);
    expect(similarity("abc", "xyz")).toBe(0);
  });
});
