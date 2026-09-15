"use client";
import { useHydrated } from "@/hooks/use-hydrated";

function formatLocal(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * Renders an ISO timestamp as `<time>`. The server and the client's first render must produce
 * identical markup, but the visitor's locale and timezone are only known in the browser, so
 * `Intl.DateTimeFormat(undefined, ...)` can disagree between server and client and trigger a
 * hydration mismatch. Until hydration finishes this shows the plain `YYYY-MM-DD` slice of the
 * ISO string instead, which is deterministic on both sides, then swaps to the localised format.
 */
export function LocalTime({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  return <time dateTime={iso}>{hydrated ? formatLocal(iso) : iso.slice(0, 10)}</time>;
}
