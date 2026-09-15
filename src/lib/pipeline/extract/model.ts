import { llmMode } from "@/lib/env";
import { StageError } from "@/lib/pipeline/errors";
import type { ModelProvider } from "@/lib/pipeline/types";
import { LiveModelProvider } from "./live-provider";
import { MockModelProvider } from "./mock-provider";
import { RecordingProvider, ReplayingProvider } from "./replay-provider";

let override: ModelProvider | null = null;
/**
 * One provider per process. The live provider owns an Anthropic client with its own connection
 * pool and retry state, and building a fresh one for every document throws that away. Keyed by
 * mode so a mode change in a long-lived process cannot serve the wrong provider.
 */
let cached: { mode: typeof llmMode; provider: ModelProvider } | null = null;

export function setModelProviderForTests(provider: ModelProvider | null): void {
  override = provider;
}

/**
 * Live callers get the replaying wrapper: a bundled sample with a recording never reaches the API,
 * so the hosted demo costs nothing to explore while a reviewer's own upload still runs for real.
 */
export function getModelProvider(): ModelProvider {
  if (override) return override;
  if (cached?.mode === llmMode) return cached.provider;
  const provider = buildProvider();
  cached = { mode: llmMode, provider };
  return provider;
}

function buildProvider(): ModelProvider {
  if (llmMode === "mock") return new MockModelProvider();
  if (llmMode === "record") {
    // Recording writes into samples/recordings, which is read-only on Vercel, and every request
    // would spend money to refresh a file it cannot save. It is a local-script mode only, and a
    // deployment configured this way is broken in a way no retry can fix.
    if (process.env.VERCEL) {
      throw new StageError("bad_llm_mode", "The server is misconfigured for model access.", "LLM_MODE=record on Vercel", { retryable: false });
    }
    return new RecordingProvider(new LiveModelProvider());
  }
  return new ReplayingProvider(new LiveModelProvider());
}
