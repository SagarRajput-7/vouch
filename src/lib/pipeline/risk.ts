export type RiskInput = {
  groundingScore: number;
  blockingIssues: number;
  warningIssues: number;
  modelConfidence: number;
  criticality: number;
};

export type RiskBand = "low" | "medium" | "high";

const MONEY = /^(subtotal|tax|shipping|discount|total)$|^lineItems\.\d+\.(amount|unitPrice)$/;
const IDENTITY = /^(vendorName|invoiceNumber|issueDate|dueDate|currency)$/;

export function criticalityFor(fieldPath: string): number {
  if (MONEY.test(fieldPath)) return 1;
  if (IDENTITY.test(fieldPath)) return 0.8;
  return 0.5;
}

export function computeRisk(i: RiskInput): number {
  const raw =
    (1 - i.groundingScore) +
    0.5 * i.blockingIssues +
    0.25 * Math.min(i.warningIssues, 2) +
    0.2 * (1 - i.modelConfidence);
  return Math.min(1, Math.max(0, raw * i.criticality));
}

export function riskBand(risk: number): RiskBand {
  if (risk < 0.2) return "low";
  if (risk < 0.5) return "medium";
  return "high";
}
