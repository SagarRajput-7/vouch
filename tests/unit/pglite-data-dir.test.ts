import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensurePgliteDir } from "@/lib/db/client";

// Proves the mkdir-before-open fix in isolation, via explicit paths passed to
// the exported helper, rather than through the app's configured env.PGLITE_DATA_DIR.
describe("ensurePgliteDir", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates a nested, non-existent data directory", () => {
    const root = path.join(tmpdir(), `vouch-pglite-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const nested = path.join(root, "nested", "pglite");
    roots.push(root);

    expect(existsSync(nested)).toBe(false);

    const result = ensurePgliteDir(nested);

    expect(result).toBe(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it("returns \":memory:\" untouched", () => {
    expect(ensurePgliteDir(":memory:")).toBe(":memory:");
  });
});
