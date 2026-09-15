import { describe, expect, it } from "vitest";
import { BudgetExceededError, budgetMicros, nextUtcMidnight, withinBudget } from "@/lib/pipeline/budget";

describe("budget", () => {
  it("converts the daily cap to micro-dollars", () => {
    expect(budgetMicros(3)).toBe(3_000_000);
  });
  it("compares spend against the cap", () => {
    expect(withinBudget(2_999_999, 3)).toBe(true);
    expect(withinBudget(3_000_000, 3)).toBe(false);
  });
  it("computes the next UTC midnight", () => {
    const now = new Date("2026-09-15T05:30:00Z");
    expect(nextUtcMidnight(now).toISOString()).toBe("2026-09-16T00:00:00.000Z");
  });
  it("carries a user-facing message", () => {
    const err = new BudgetExceededError(3_100_000, 3);
    expect(err.userMessage).toContain("resumes");
  });
});
