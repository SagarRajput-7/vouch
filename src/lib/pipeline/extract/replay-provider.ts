import type { ExtractOptions, ModelInput, ModelProvider, ModelUsage } from "@/lib/pipeline/types";
import { readRecording, RECORDINGS_DIR, writeRecording, type Recording } from "./recordings";

/** A focused re-read is a reconcile, anything else is the document's first look. */
export const kindFor = (options?: ExtractOptions): Recording["kind"] => (options?.focus ? "reconcile" : "initial");

/** Serves recorded sample extractions before touching the wrapped provider, so bundled samples never cost money. */
export class ReplayingProvider implements ModelProvider {
  readonly name: string;
  constructor(private readonly inner: ModelProvider, private readonly dir: string = RECORDINGS_DIR) {
    this.name = inner.name;
  }

  /** A recorded answer spends nothing, so the caller can skip the budget guard for it. */
  async isFree(input: ModelInput, options?: ExtractOptions): Promise<boolean> {
    return (await readRecording(input.sha256, kindFor(options), this.dir)) !== null;
  }

  async extract(input: ModelInput, options?: ExtractOptions) {
    const started = Date.now();
    const rec = await readRecording(input.sha256, kindFor(options), this.dir);
    if (!rec) return this.inner.extract(input, options);
    const usage: ModelUsage = { model: "replay", inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, latencyMs: Date.now() - started, costMicros: 0 };
    return {
      result: rec.result,
      usage,
      raw: { source: "recording", model: rec.model, promptVersion: rec.promptVersion, recordedAt: rec.recordedAt, recordedUsage: rec.usage },
      promptVersion: rec.promptVersion,
    };
  }
}

/**
 * Passes every call through and saves the answer, so `pnpm samples:record` can refresh the
 * recordings. A failed call is never recorded: the error propagates untouched, so the stage above
 * still sees the usage it carries and the ledger still hears about the tokens it spent.
 */
export class RecordingProvider implements ModelProvider {
  readonly name = "record";
  constructor(private readonly inner: ModelProvider, private readonly dir: string = RECORDINGS_DIR) {}

  async extract(input: ModelInput, options?: ExtractOptions) {
    const out = await this.inner.extract(input, options);
    const { model, ...usage } = out.usage;
    await writeRecording(
      { sha256: input.sha256, kind: kindFor(options), model, promptVersion: out.promptVersion, recordedAt: new Date().toISOString(), result: out.result, usage },
      this.dir,
    );
    return out;
  }
}
