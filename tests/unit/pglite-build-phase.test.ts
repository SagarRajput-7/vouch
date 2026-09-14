import { describe, expect, it } from "vitest";
import { shouldUseInMemoryPglite } from "@/lib/db/client";

// Proves the build-time-race fix in isolation, via explicit env shapes passed to the
// exported pure helper, rather than through the app's actual process.env / env.ts.
describe("shouldUseInMemoryPglite", () => {
  it("is true during the production build phase with no database URL configured", () => {
    expect(
      shouldUseInMemoryPglite({
        NEXT_PHASE: "phase-production-build",
        DATABASE_URL: undefined,
        PGLITE_DATA_DIR: ".data/pglite",
      }),
    ).toBe(true);
  });

  it("is true whenever the data dir is explicitly \":memory:\", regardless of phase", () => {
    expect(
      shouldUseInMemoryPglite({ NEXT_PHASE: undefined, DATABASE_URL: undefined, PGLITE_DATA_DIR: ":memory:" }),
    ).toBe(true);
    expect(
      shouldUseInMemoryPglite({
        NEXT_PHASE: "phase-production-build",
        DATABASE_URL: undefined,
        PGLITE_DATA_DIR: ":memory:",
      }),
    ).toBe(true);
  });

  it("is false outside the production build phase", () => {
    expect(
      shouldUseInMemoryPglite({ NEXT_PHASE: undefined, DATABASE_URL: undefined, PGLITE_DATA_DIR: ".data/pglite" }),
    ).toBe(false);
    expect(
      shouldUseInMemoryPglite({
        NEXT_PHASE: "phase-development-server",
        DATABASE_URL: undefined,
        PGLITE_DATA_DIR: ".data/pglite",
      }),
    ).toBe(false);
  });

  it("is false during the build phase when a real database URL is configured", () => {
    expect(
      shouldUseInMemoryPglite({
        NEXT_PHASE: "phase-production-build",
        DATABASE_URL: "postgres://example",
        PGLITE_DATA_DIR: ".data/pglite",
      }),
    ).toBe(false);
  });
});
