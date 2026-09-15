import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractOptions, ModelInput, ModelProvider, ModelUsage } from "@/lib/pipeline/types";
import { groundTruthSchema, manifestSchema, type GroundTruth } from "./ground-truth";
import { readRecording } from "./recordings";
import { extractionResultSchema, fieldNames, type ExtractionResult } from "./schema";

export type GroundTruthLookup = (sha256: string) => Promise<GroundTruth | null>;

export const MOCK_PROMPT_VERSION = "mock-1";

const SAMPLES_DIR = path.join(process.cwd(), "samples");

/** Default lookup: samples/manifest.json maps sha256 to a ground-truth file. */
export const manifestLookup: GroundTruthLookup = async (sha256) => {
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(path.join(SAMPLES_DIR, "manifest.json"), "utf8");
  } catch {
    return null;
  }
  const manifest = manifestSchema.parse(JSON.parse(manifestRaw));
  const entry = manifest.find((m) => m.sha256 === sha256);
  if (!entry) return null;
  const gtRaw = await readFile(path.join(SAMPLES_DIR, "ground-truth", `${entry.name}.json`), "utf8");
  return groundTruthSchema.parse(JSON.parse(gtRaw));
};

export function groundTruthToExtraction(gt: GroundTruth): ExtractionResult {
  const fields = Object.fromEntries(
    fieldNames.map((name) => {
      const f = gt.fields[name];
      return [
        name,
        f
          ? { value: f.value, sourceText: f.display ?? f.value, page: f.page ?? 1, confidence: 0.9 }
          : { value: null, sourceText: null, page: null, confidence: 0.9 },
      ];
    }),
  ) as ExtractionResult["fields"];

  const lineItems = gt.lineItems.map((li) => ({
    description: { value: li.description, sourceText: li.description, page: li.page ?? 1, confidence: 0.9 },
    quantity: { value: li.quantity, sourceText: li.display?.quantity ?? li.quantity, page: li.page ?? 1, confidence: 0.9 },
    unitPrice: { value: li.unitPrice, sourceText: li.display?.unitPrice ?? li.unitPrice, page: li.page ?? 1, confidence: 0.9 },
    amount: { value: li.amount, sourceText: li.display?.amount ?? li.amount, page: li.page ?? 1, confidence: 0.9 },
  }));

  return extractionResultSchema.parse({
    docType: {
      value: gt.docType,
      confidence: 0.95,
      reason: gt.docType === "other" ? "This document is not an invoice." : "Sample ground truth.",
    },
    fields,
    lineItems,
    notes: gt.notes ?? null,
  });
}

export class MockModelProvider implements ModelProvider {
  readonly name = "mock";
  constructor(private readonly lookup: GroundTruthLookup = manifestLookup) {}

  /**
   * A recorded live answer for this file hash wins over the hand-written ground truth, so the
   * offline demo shows what the model actually said. A reconcile with no recording falls back to
   * the ground truth, which is the same answer the first look gave, so a mock second look is never
   * "better" and is never adopted.
   */
  async extract(input: ModelInput, options?: ExtractOptions) {
    const started = Date.now();
    const rec = await readRecording(input.sha256, options?.focus ? "reconcile" : "initial");
    const gt = rec ? null : await this.lookup(input.sha256);
    const result: ExtractionResult = rec
      ? rec.result
      : gt
        ? groundTruthToExtraction(gt)
        : extractionResultSchema.parse({
            docType: {
              value: "other",
              confidence: 1,
              reason: "Mock mode only recognises the bundled sample documents. Set ANTHROPIC_API_KEY to extract your own files.",
            },
            fields: Object.fromEntries(fieldNames.map((f) => [f, { value: null, sourceText: null, page: null, confidence: 1 }])),
            lineItems: [],
            notes: null,
          });
    const usage: ModelUsage = {
      model: "mock",
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      latencyMs: Date.now() - started,
      costMicros: 0,
    };
    return {
      result,
      usage,
      raw: { source: rec ? "recording" : gt ? "ground-truth" : "unknown", sha256: input.sha256, recordedModel: rec?.model ?? null },
      promptVersion: rec ? rec.promptVersion : MOCK_PROMPT_VERSION,
    };
  }
}
