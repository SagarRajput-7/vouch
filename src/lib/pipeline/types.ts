import type { SupportedMime } from "@/lib/files/detect-type";
import type { PositionedToken } from "@/lib/db/schema";
import type { Document } from "@/lib/repo/documents";
import type { ExtractionResult } from "./extract/schema";

export type ModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  latencyMs: number;
  costMicros: number;
};

export type ModelInput = { bytes: Uint8Array; mime: SupportedMime; sha256: string; filename: string };

export type ExtractOptions = { focus?: { fieldPaths: string[]; reason: string } };

export interface ModelProvider {
  readonly name: string;
  extract(input: ModelInput, options?: ExtractOptions): Promise<{ result: ExtractionResult; usage: ModelUsage; raw: unknown }>;
}

export type StageName = "parse" | "extract" | "ground" | "validate" | "reconcile" | "finalise";

export type ParsedPage = {
  pageNo: number;
  width: number;
  height: number;
  rotation: number;
  textSource: "pdf" | "ocr" | "none";
  ocrMeanConfidence: number | null;
  tokens: PositionedToken[];
};

export type Grounding = {
  page: number;
  bbox: [number, number, number, number];
  groundingScore: number;
  groundingMethod: "exact" | "normalized" | "fuzzy";
  matchedText: string;
  /** Line id of the first matched token, used to keep line-item cells on the same row. */
  line: number;
  /** Token index range [start, end) on that page, so later fields can avoid reusing the same tokens. */
  range: [number, number];
};

export type IssueDraft = {
  code: string;
  severity: "blocking" | "warning" | "info";
  fieldPaths: string[];
  message: string;
  suggestion: Record<string, unknown> | null;
};

export type StageState = {
  pages?: ParsedPage[];
  extraction?: ExtractionResult;
  grounding?: Record<string, Grounding | null>;
  issues?: IssueDraft[];
};

export type StageContext = {
  documentId: string;
  workspaceId: string;
  jobId: string;
  document: Document;
  state: StageState;
};

export type StageOutcome = { halt?: boolean; meta?: Record<string, unknown> };

export type Stage = { name: StageName; run(ctx: StageContext): Promise<StageOutcome> };
