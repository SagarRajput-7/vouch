import { describe, expect, it } from "vitest";
import { computeRisk, criticalityFor, riskBand } from "@/lib/pipeline/risk";

describe("risk", () => {
  it("is low for an exactly grounded clean money field", () => {
    const r = computeRisk({ groundingScore: 1, blockingIssues: 0, warningIssues: 0, modelConfidence: 0.95, criticality: 1 });
    expect(r).toBeLessThan(0.2);
    expect(riskBand(r)).toBe("low");
  });
  it("is high for an ungrounded money field", () => {
    const r = computeRisk({ groundingScore: 0, blockingIssues: 0, warningIssues: 0, modelConfidence: 0.95, criticality: 1 });
    expect(riskBand(r)).toBe("high");
  });
  it("a blocking issue pushes a grounded field to high", () => {
    const r = computeRisk({ groundingScore: 1, blockingIssues: 1, warningIssues: 0, modelConfidence: 0.95, criticality: 1 });
    expect(riskBand(r)).toBe("high");
  });
  it("warnings cap at two and scale with criticality", () => {
    const money = computeRisk({ groundingScore: 1, blockingIssues: 0, warningIssues: 5, modelConfidence: 1, criticality: 1 });
    const other = computeRisk({ groundingScore: 1, blockingIssues: 0, warningIssues: 5, modelConfidence: 1, criticality: 0.5 });
    expect(money).toBeCloseTo(0.5, 5);
    expect(other).toBeCloseTo(0.25, 5);
    expect(riskBand(money)).toBe("high");
    expect(riskBand(other)).toBe("medium");
  });
  it("assigns criticality by field path", () => {
    expect(criticalityFor("total")).toBe(1);
    expect(criticalityFor("lineItems.3.amount")).toBe(1);
    expect(criticalityFor("invoiceNumber")).toBe(0.8);
    expect(criticalityFor("issueDate")).toBe(0.8);
    expect(criticalityFor("lineItems.0.description")).toBe(0.5);
  });
});
