import { describe, expect, it } from "vitest";
import { PRICING, costMicros } from "@/lib/pipeline/extract/cost";

describe("costMicros", () => {
  it("prices Sonnet 5 tokens in micro-dollars", () => {
    expect(PRICING["claude-sonnet-5"]).toEqual({ input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 });
    const micros = costMicros({ model: "claude-sonnet-5", inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 0, costMicros: 0 });
    expect(micros).toBe(2_000_000);
  });
  it("adds every token class", () => {
    const micros = costMicros({ model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 500, cacheWriteTokens: 2000, cacheReadTokens: 10_000, latencyMs: 0, costMicros: 0 });
    expect(micros).toBe(14_000);
  });
  it("is zero for the mock model", () => {
    expect(costMicros({ model: "mock", inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 0, costMicros: 0 })).toBe(0);
  });
  it("prices an unrecognised non-free model at the Sonnet 5 rate instead of costing nothing", () => {
    const micros = costMicros({ model: "claude-sonnet-5-20261001", inputTokens: 1_000_000, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 0, costMicros: 0 });
    expect(micros).toBe(2_000_000);
  });
  it("is zero for a replay model", () => {
    expect(costMicros({ model: "replay", inputTokens: 5, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 0, costMicros: 0 })).toBe(0);
  });
});
