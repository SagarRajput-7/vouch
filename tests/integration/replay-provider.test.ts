import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readRecording, writeRecording, type Recording } from "@/lib/pipeline/extract/recordings";
import { RecordingProvider, ReplayingProvider } from "@/lib/pipeline/extract/replay-provider";
import { extractionResultSchema, fieldNames } from "@/lib/pipeline/extract/schema";
import type { ModelProvider } from "@/lib/pipeline/types";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "vouch-replay-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const emptyResult = extractionResultSchema.parse({
  docType: { value: "invoice", confidence: 0.9, reason: "r" },
  fields: Object.fromEntries(fieldNames.map((f) => [f, { value: null, sourceText: null, page: null, confidence: 0.5 }])),
  lineItems: [],
  notes: null,
});
const usage = { model: "claude-sonnet-5", inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 10, costMicros: 700 };
const input = { bytes: new Uint8Array([1]), mime: "application/pdf" as const, sha256: "b".repeat(64), filename: "x.pdf" };

function inner(): ModelProvider & { calls: number } {
  const p = {
    name: "live",
    calls: 0,
    async extract() {
      p.calls += 1;
      return { result: emptyResult, usage, raw: {}, promptVersion: "live-1" };
    },
  };
  return p;
}

describe("ReplayingProvider", () => {
  it("serves a recording at zero cost and otherwise delegates", async () => {
    const live = inner();
    const provider = new ReplayingProvider(live, dir);
    const first = await provider.extract(input);
    expect(live.calls).toBe(1);
    expect(first.usage.costMicros).toBe(700);
    const rec: Recording = {
      sha256: input.sha256,
      kind: "initial",
      model: "claude-sonnet-5",
      promptVersion: "live-1",
      recordedAt: "2026-09-15T00:00:00.000Z",
      result: emptyResult,
      usage: { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 10, costMicros: 700 },
    };
    await writeRecording(rec, dir);
    const second = await provider.extract(input);
    expect(live.calls).toBe(1);
    expect(second.usage).toMatchObject({ model: "replay", costMicros: 0 });
    expect(second.promptVersion).toBe("live-1");
    expect(second.raw).toMatchObject({ source: "recording", recordedUsage: rec.usage });
    await provider.extract(input, { focus: { fieldPaths: ["total"], reason: "r" } });
    expect(live.calls).toBe(2);
  });
});

describe("RecordingProvider", () => {
  it("writes a recording after each live call", async () => {
    const live = inner();
    const provider = new RecordingProvider(live, dir);
    await provider.extract({ ...input, sha256: "c".repeat(64) }, { focus: { fieldPaths: ["total"], reason: "r" } });
    const rec = await readRecording("c".repeat(64), "reconcile", dir);
    expect(rec).toMatchObject({ kind: "reconcile", model: "claude-sonnet-5", promptVersion: "live-1", usage: { costMicros: 700 } });
  });

  it("writes nothing and rethrows when the inner call fails", async () => {
    const failing: ModelProvider = {
      name: "live",
      async extract() {
        throw new Error("model exploded");
      },
    };
    const provider = new RecordingProvider(failing, dir);
    await expect(provider.extract({ ...input, sha256: "d".repeat(64) })).rejects.toThrow("model exploded");
    expect(await readRecording("d".repeat(64), "initial", dir)).toBeNull();
  });
});
