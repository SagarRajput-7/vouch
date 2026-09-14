import { forbidden } from "./errors";

/** Blocks cross-site mutations. Same-origin fetches send sec-fetch-site: same-origin; tests and curl send none. */
export function assertSameOrigin(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw forbidden();
  const origin = request.headers.get("origin");
  if (origin) {
    const expected = new URL(request.url).host;
    let actual: string;
    try {
      actual = new URL(origin).host;
    } catch {
      throw forbidden();
    }
    if (actual !== expected) throw forbidden();
  }
}
