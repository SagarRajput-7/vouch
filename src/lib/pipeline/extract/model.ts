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
  if (llmMode === "record") return new RecordingProvider(new LiveModelProvider());
  return new ReplayingProvider(new LiveModelProvider());
}
