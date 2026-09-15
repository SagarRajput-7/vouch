import { log } from "@/lib/logger";
import type { ModelUsage } from "@/lib/pipeline/types";

/** USD per million tokens. */
export const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

/** Models that never cost anything: the mock provider and recorded replays. */
export const FREE_MODELS = new Set(["mock", "replay"]);

/**
 * Micro-dollars for one call. A free model costs nothing. A model that is neither free nor in
 * `PRICING` (a dated snapshot, a rename, or the API's echoed `response.model`) is priced at the
 * Sonnet 5 rate as a conservative estimate rather than silently costing nothing, and logs a
 * warning so the drift gets noticed instead of quietly defeating the daily budget guard. It
 * never throws: by the time cost is computed the money is already spent, and the ledger must
 * still record it.
 */
export function costMicros(u: ModelUsage): number {
  if (FREE_MODELS.has(u.model)) return 0;
  let p = PRICING[u.model];
  if (!p) {
    log.warn("cost.unknown_model", { model: u.model });
    p = PRICING["claude-sonnet-5"];
  }
  return Math.round(u.inputTokens * p.input + u.outputTokens * p.output + u.cacheWriteTokens * p.cacheWrite + u.cacheReadTokens * p.cacheRead);
}
