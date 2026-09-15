import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groundTruthSchema } from "@/lib/pipeline/extract/ground-truth";
import { manifestLookup, MockModelProvider, MOCK_PROMPT_VERSION } from "@/lib/pipeline/extract/mock-provider";
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
const recordedUsage = { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: 10, costMicros: 700 };

function recordingFor(sha256: string, kind: Recording["kind"], result = emptyResult): Recording {
  return { sha256, kind, model: "claude-sonnet-5", promptVersion: "live-1", recordedAt: "2026-09-15T00:00:00.000Z", result, usage: recordedUsage };
}

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
    const rec = recordingFor(input.sha256, "initial");
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

describe("ReplayingProvider.isFree", () => {
  it("reports a call as free only when its own recording exists", async () => {
    const live = inner();
    const provider = new ReplayingProvider(live, dir);
    const sha = "f".repeat(64);
    expect(await provider.isFree({ ...input, sha256: sha })).toBe(false);
    await writeRecording(recordingFor(sha, "initial"), dir);
    expect(await provider.isFree({ ...input, sha256: sha })).toBe(true);
    // The reconcile kind is a separate recording, so a first-look hit does not excuse the second.
    expect(await provider.isFree({ ...input, sha256: sha }, { focus: { fieldPaths: ["total"], reason: "r" } })).toBe(false);
    expect(live.calls).toBe(0);
  });
});

describe("MockModelProvider and recordings", () => {
  const sha = "e".repeat(64);
  const recordedResult = extractionResultSchema.parse({
    ...emptyResult,
    fields: { ...emptyResult.fields, vendorName: { value: "Recorded Vendor", sourceText: "Recorded Vendor", page: 1, confidence: 0.9 } },
  });
  const fixture = groundTruthSchema.parse({
    name: "fixture",
    docType: "invoice",
    fields: Object.fromEntries(fieldNames.map((f) => [f, f === "vendorName" ? { value: "Fixture Vendor", page: 1 } : null])),
    lineItems: [],
    expectedIssues: [],
  });

  beforeAll(async () => {
    await writeRecording({ ...recordingFor(sha, "initial", recordedResult), promptVersion: "live-7" }, dir);
  });

  it("replays the recording when it holds the default manifest lookup", async () => {
    const mock = new MockModelProvider(manifestLookup, dir);
    const out = await mock.extract({ ...input, sha256: sha });
    expect(out.result.fields.vendorName.value).toBe("Recorded Vendor");
    expect(out.promptVersion).toBe("live-7");
    expect(out.raw).toMatchObject({ source: "recording", recordedModel: "claude-sonnet-5" });
    expect(out.usage).toMatchObject({ model: "mock", costMicros: 0 });
  });

  it("ignores recordings when a test injected its own lookup", async () => {
    const mock = new MockModelProvider(async () => fixture, dir);
    const out = await mock.extract({ ...input, sha256: sha });
    expect(out.result.fields.vendorName.value).toBe("Fixture Vendor");
    expect(out.promptVersion).toBe(MOCK_PROMPT_VERSION);
    expect(out.raw).toMatchObject({ source: "ground-truth" });
  });

  it("answers every call for free", async () => {
    expect(await new MockModelProvider(manifestLookup, dir).isFree()).toBe(true);
  });
});
