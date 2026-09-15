import { llmMode } from "@/lib/env";
import type { ModelProvider } from "@/lib/pipeline/types";
import { LiveModelProvider } from "./live-provider";
import { MockModelProvider } from "./mock-provider";
import { RecordingProvider, ReplayingProvider } from "./replay-provider";

let override: ModelProvider | null = null;

export function setModelProviderForTests(provider: ModelProvider | null): void {
  override = provider;
}

/**
 * Live callers get the replaying wrapper: a bundled sample with a recording never reaches the API,
 * so the hosted demo costs nothing to explore while a reviewer's own upload still runs for real.
 */
export function getModelProvider(): ModelProvider {
  if (override) return override;
  if (llmMode === "mock") return new MockModelProvider();
  if (llmMode === "record") {
    // Recording writes into samples/recordings, which is read-only on Vercel, and every request
    // would spend money to refresh a file it cannot save. It is a local-script mode only.
    if (process.env.VERCEL) throw new Error("LLM_MODE=record is for local scripts only");
    return new RecordingProvider(new LiveModelProvider());
  }
  return new ReplayingProvider(new LiveModelProvider());
}
