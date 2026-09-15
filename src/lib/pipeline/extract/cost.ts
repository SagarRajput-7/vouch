import type { ModelUsage } from "@/lib/pipeline/types";

/** USD per million tokens. */
export const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

/** Micro-dollars for one call. Unknown models (the mock) cost nothing. */
export function costMicros(u: ModelUsage): number {
  const p = PRICING[u.model];
  if (!p) return 0;
  return Math.round(u.inputTokens * p.input + u.outputTokens * p.output + u.cacheWriteTokens * p.cacheWrite + u.cacheReadTokens * p.cacheRead);
}
