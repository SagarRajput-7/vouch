import type { ModelUsage } from "@/lib/pipeline/types";

export class StageError extends Error {
  readonly retryable: boolean;
  readonly usage: ModelUsage | null;

  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    detail?: string,
    opts: { retryable?: boolean; usage?: ModelUsage } = {},
  ) {
    super(detail ?? userMessage);
    this.name = "StageError";
    this.retryable = opts.retryable ?? true;
    this.usage = opts.usage ?? null;
  }
}

export function toFailure(err: unknown): { code: string; message: string } {
  if (err instanceof StageError) return { code: err.code, message: err.userMessage };
  return { code: "internal", message: "Processing failed. Try again." };
}
