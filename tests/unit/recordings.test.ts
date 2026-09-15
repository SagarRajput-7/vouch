import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readRecording, recordingFile, writeRecording, type Recording } from "@/lib/pipeline/extract/recordings";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "vouch-rec-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const rec: Recording = {
  sha256: "a".repeat(64),
  kind: "initial",
  model: "claude-sonnet-5",
  promptVersion: "live-1",
  recordedAt: "2026-09-15T00:00:00.000Z",
  result: {
    docType: { value: "invoice", confidence: 0.9, reason: "It bills for services." },
    fields: Object.fromEntries(
      ["vendorName", "invoiceNumber", "issueDate", "dueDate", "currency", "subtotal", "tax", "shipping", "discount", "total"].map((f) => [
        f,
        { value: null, sourceText: null, page: null, confidence: 0.5 },
      ]),
    ) as Recording["result"]["fields"],
    lineItems: [],
    notes: null,
  },
  usage: { inputTokens: 1, outputTokens: 2, cacheWriteTokens: 3, cacheReadTokens: 4, latencyMs: 5, costMicros: 6 },
};

describe("recordings", () => {
  it("names files by hash and kind", () => {
    expect(path.basename(recordingFile("abc", "reconcile"))).toBe("abc.reconcile.json");
  });
  it("round-trips through disk and returns null when absent", async () => {
    expect(await readRecording(rec.sha256, "initial", dir)).toBeNull();
    await writeRecording(rec, dir);
    expect(await readRecording(rec.sha256, "initial", dir)).toEqual(rec);
    expect(await readRecording(rec.sha256, "reconcile", dir)).toBeNull();
  });
  it("refuses a recording whose contents disagree with its filename", async () => {
    const other = "b".repeat(64);
    await writeFile(recordingFile(other, "initial", dir), JSON.stringify(rec));
    await expect(readRecording(other, "initial", dir)).rejects.toThrow(/refusing to replay/);
    await writeFile(recordingFile(other, "reconcile", dir), JSON.stringify({ ...rec, sha256: other }));
    await expect(readRecording(other, "reconcile", dir)).rejects.toThrow(/refusing to replay/);
  });
});
