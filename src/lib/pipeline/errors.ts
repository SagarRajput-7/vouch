export class StageError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    detail?: string,
  ) {
    super(detail ?? userMessage);
    this.name = "StageError";
  }
}

export function toFailure(err: unknown): { code: string; message: string } {
  if (err instanceof StageError) return { code: err.code, message: err.userMessage };
  return { code: "internal", message: "Processing failed. Try again." };
}
