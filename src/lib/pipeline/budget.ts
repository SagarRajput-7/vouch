import { env } from "@/lib/env";
import { usageRepo } from "@/lib/repo/usage";

export class BudgetExceededError extends Error {
  readonly code = "budget_paused";
  readonly userMessage = "Daily model budget reached. Processing resumes automatically tomorrow.";
  constructor(
    public readonly spentMicros: number,
    public readonly capUsd: number,
  ) {
    super(`Daily model budget exceeded: ${spentMicros} micro-dollars against a cap of ${capUsd} USD`);
    this.name = "BudgetExceededError";
  }
}

export function budgetMicros(capUsd: number): number {
  return Math.round(capUsd * 1_000_000);
}

export function withinBudget(spentMicros: number, capUsd: number): boolean {
  return spentMicros < budgetMicros(capUsd);
}

export function nextUtcMidnight(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return d;
}

/** Throws BudgetExceededError when today's spend has reached the cap. Cheap: one aggregate query. */
export async function assertWithinBudget(now: Date = new Date()): Promise<void> {
  const spent = await usageRepo.dailyTotalMicros(now);
  if (!withinBudget(spent, env.BUDGET_DAILY_USD)) throw new BudgetExceededError(spent, env.BUDGET_DAILY_USD);
}
