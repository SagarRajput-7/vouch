import { describe, expect, it } from "vitest";
import { parseMoney } from "@/lib/normalize/money";

describe("parseMoney", () => {
  it.each([
    ["1,234.56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["1 234,56", "1234.56"],
    ["1,23,456.00", "123456.00"],
    ["$1,234.56", "1234.56"],
    ["USD 12", "12.00"],
    ["(123.45)", "-123.45"],
    ["-5", "-5.00"],
    ["12,34", "12.34"],
    ["1,234", "1234.00"],
    ["1.234", "1234.00"],
    ["0.5", "0.50"],
    ["€ 99,90", "99.90"],
    ["₹1,50,000", "150000.00"],
    ["1'234.50", "1234.50"],
    ["1764.48", "1764.48"],
    // A three-digit run after the separator is a thousands group only when the integer part
    // could be one: "1.500" is 1500, but nobody writes 125 as "0.125", so that is a fraction.
    ["0.125", "0.13"],
    ["0,125", "0.13"],
    ["1.500", "1500.00"],
    ["1,500", "1500.00"],
  ])("parses %s to %s", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });
  it("returns null when there are no digits", () => {
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
});
