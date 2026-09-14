import type { SupportedMime } from "@/lib/files/detect-type";
import type { Document } from "@/lib/repo/documents";
import type { ExtractionResult } from "./extract/schema";

export type ModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
};

export type ModelInput = { bytes: Uint8Array; mime: SupportedMime; sha256: string; filename: string };

export interface ModelProvider {
  readonly name: string;
  extract(input: ModelInput): Promise<{ result: ExtractionResult; usage: ModelUsage; raw: unknown }>;
}

export type StageName = "parse" | "extract" | "ground" | "validate" | "reconcile" | "finalise";

export type StageState = { extraction?: ExtractionResult };

export type StageContext = {
  documentId: string;
  workspaceId: string;
  jobId: string;
  document: Document;
  state: StageState;
};

export type StageOutcome = { halt?: boolean; meta?: Record<string, unknown> };

export type Stage = { name: StageName; run(ctx: StageContext): Promise<StageOutcome> };
