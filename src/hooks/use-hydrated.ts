"use client";
import { useSyncExternalStore } from "react";

/**
 * True only after the client has hydrated. Server render and the first client render must
 * agree, so anything that would differ between them (locale- or timezone-dependent formatting,
 * `next-themes`' resolved theme, and the like) should render its server-safe form until this
 * flips to true, then switch. Subscribing to nothing and returning a constant snapshot per side
 * is the standard way to get exactly one extra render after mount with no real external store.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
