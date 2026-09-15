import { describe, expect, it } from "vitest";
import { dateEquals, isIsoDate, parseDate } from "@/lib/normalize/dates";

describe("parseDate", () => {
  it.each([
    ["2026-08-03", undefined, "2026-08-03"],
    ["Aug 3, 2026", undefined, "2026-08-03"],
    ["August 3rd, 2026", undefined, "2026-08-03"],
    ["3 Aug 2026", undefined, "2026-08-03"],
    ["03 August 2026", undefined, "2026-08-03"],
    ["21/07/2026", undefined, "2026-07-21"],
    ["07/21/2026", undefined, "2026-07-21"],
    ["03.08.2026", undefined, "2026-08-03"],
    ["03/08/2026", "dmy", "2026-08-03"],
    ["03/08/2026", "mdy", "2026-03-08"],
    ["21/07/2026", "mdy", "2026-07-21"],
    ["07/21/2026", "dmy", "2026-07-21"],
    ["2026/08/03", undefined, "2026-08-03"],
    ["Sep 2, 2026", undefined, "2026-09-02"],
  ])("parses %s (%s) to %s", (input, hint, expected) => {
    expect(parseDate(input, hint as "dmy" | "mdy" | undefined)).toBe(expected);
  });
  it("defaults ambiguous numeric dates to day-first", () => {
    expect(parseDate("03/08/2026")).toBe("2026-08-03");
  });
  it("rejects nonsense", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("hello")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("dateEquals and isIsoDate", () => {
  it("compares printed dates to ISO values", () => {
    expect(dateEquals("Aug 3, 2026", "2026-08-03")).toBe(true);
    expect(dateEquals("21/07/2026", "2026-07-21")).toBe(true);
    expect(dateEquals("21/07/2026", "2026-07-22")).toBe(false);
  });
  it("validates ISO strings", () => {
    expect(isIsoDate("2026-08-03")).toBe(true);
    expect(isIsoDate("2026-13-03")).toBe(false);
    expect(isIsoDate("Aug 3")).toBe(false);
  });
});
