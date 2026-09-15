import { describe, expect, it } from "vitest";
import { absCents, fromCents, mulToCents, parseDecimal, toCents } from "@/lib/normalize/money";

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

describe("parseDecimal", () => {
  it("keeps sub-cent precision across locales and rounds half up", () => {
    expect(parseDecimal("0.0125")).toBe("0.0125");
    expect(parseDecimal("2,160")).toBe("2160.0000");
    expect(parseDecimal("1.234,5")).toBe("1234.5000");
    expect(parseDecimal("0.00005")).toBe("0.0001");
    expect(parseDecimal("(2.5)")).toBe("-2.5000");
    expect(parseDecimal("each")).toBeNull();
  });
  it("reads a three-digit run with no usable integer part as a fraction, not a thousands group", () => {
    // A metered unit price of 0.125 is common, printed with or without its leading zero;
    // 125 printed as "0.125" or ".125" is not.
    expect(parseDecimal("0.125")).toBe("0.1250");
    expect(parseDecimal("0,125")).toBe("0.1250");
    expect(parseDecimal("00.125")).toBe("0.1250");
    expect(parseDecimal(".125")).toBe("0.1250");
    expect(parseDecimal(",125")).toBe("0.1250");
    expect(parseDecimal("1.500")).toBe("1500.0000");
  });
});
