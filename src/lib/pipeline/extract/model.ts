import { llmMode } from "@/lib/env";
import type { ModelProvider } from "@/lib/pipeline/types";
import { LiveModelProvider } from "./live-provider";
import { MockModelProvider } from "./mock-provider";

let override: ModelProvider | null = null;

export function setModelProviderForTests(provider: ModelProvider | null): void {
  override = provider;
}

export function getModelProvider(): ModelProvider {
  if (override) return override;
  if (llmMode === "mock") return new MockModelProvider();
  return new LiveModelProvider();
}
