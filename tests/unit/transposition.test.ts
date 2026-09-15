import { describe, expect, it } from "vitest";
import { adjacentDigitSwaps, isAdjacentTransposition } from "@/lib/pipeline/validate/transposition";

describe("adjacentDigitSwaps", () => {
  it("lists every single adjacent digit swap without leading zeros", () => {
    expect(adjacentDigitSwaps("719.70").sort()).toEqual(["179.70", "719.07", "791.70"].sort());
    expect(adjacentDigitSwaps("70.00")).toEqual([]);
    expect(adjacentDigitSwaps("1.00")).toEqual([]);
  });
  it("recognises a transposition", () => {
    expect(isAdjacentTransposition("719.70", "791.70")).toBe(true);
    expect(isAdjacentTransposition("745.00", "754.00")).toBe(true);
    expect(isAdjacentTransposition("719.70", "719.71")).toBe(false);
  });
});
