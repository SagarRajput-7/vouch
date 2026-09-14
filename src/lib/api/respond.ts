import { ZodError } from "zod";
import { ApiError } from "./errors";
import { errorMessage, log } from "@/lib/logger";

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

// The context parameter is declared optional so routes with no dynamic segment type-check
// when called with just a request (as the integration tests and Next's own dispatch for
// static routes do). Extracting the signature from a method (rather than a plain function
// property) makes its parameter checked bivariantly instead of strictly contravariantly, so a
// dynamic route's handler can still declare its context as always-present and destructure
// `params` directly, without every caller being forced to pass one.
type Handler<C> = { fn(request: Request, context?: C): Promise<Response> }["fn"];

/** Wraps a route handler so thrown errors become consistent JSON responses. */
export function handle<C = { params?: Promise<Record<string, string>> }>(fn: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await fn(request, context);
    } catch (err) {
      if (err instanceof ApiError) {
        return json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.status);
      }
      if (err instanceof ZodError) {
        return json({ error: { code: "invalid_request", message: "The request was not valid.", details: err.issues } }, 400);
      }
      const id = crypto.randomUUID();
      log.error("request.failed", { id, url: request.url, error: errorMessage(err) });
      return json({ error: { code: "internal", message: `Something went wrong. Reference ${id}.` } }, 500);
    }
  };
}
