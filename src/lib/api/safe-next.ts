/**
 * Validates the `next` redirect target from an untrusted query string.
 *
 * WHATWG URL parsing treats a backslash the same as a forward slash for
 * special schemes like http/https, so a value such as "/\evil.com" that
 * merely *looks* like an internal path is normalized to a network-path
 * reference ("//evil.com") and hijacks the origin when resolved against a
 * base URL. Rejecting any backslash up front, then re-parsing against a
 * fixed dummy origin and checking the origin survived unchanged, closes
 * that hole and any other WHATWG normalization quirk with the same effect.
 */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const u = new URL(raw, "http://internal.invalid");
    if (u.origin !== "http://internal.invalid") return "/";
    return u.pathname + u.search;
  } catch {
    return "/";
  }
}
