import { StageError } from "@/lib/pipeline/errors";

/**
 * Races a pdf.js operation against a timer. pdf.js offers no cancellation, so a malformed file
 * that sends one of its loops spinning would otherwise hold the whole function until the platform
 * kills it mid-job, with no message for the person who uploaded. The loser of the race is left to
 * finish on its own; Promise.race has already attached a handler to it, so a failure arriving
 * after the timeout is observed rather than crashing the process as an unhandled rejection.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new StageError("pdf_timeout", "This PDF took too long to read. It may be damaged.", what, { retryable: false })),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
