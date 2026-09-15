import { describe, expect, it } from "vitest";
import { absCents, fromCents, mulToCents, toCents } from "@/lib/normalize/money";

describe("cents helpers", () => {
  it("round-trips canonical strings", () => {
    expect(toCents("1764.48")).toBe(BigInt(176448));
    expect(toCents("-50.00")).toBe(BigInt(-5000));
    expect(fromCents(BigInt(176448))).toBe("1764.48");
    expect(fromCents(BigInt(-5))).toBe("-0.05");
    expect(fromCents(BigInt(0))).toBe("0.00");
    expect(() => toCents("1,764.48")).toThrow();
  });
  it("multiplies four-decimal quantities and prices to rounded cents", () => {
    expect(mulToCents("12.0000", "38.5000")).toBe(BigInt(46200));
    expect(mulToCents("3", "0.3333")).toBe(BigInt(100));
    expect(mulToCents("2160.0000", "12.5000")).toBe(BigInt(2700000));
  });
  it("absCents", () => {
    expect(absCents(BigInt(-7))).toBe(BigInt(7));
  });
});
