import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/files/hash";
import { groundTruthSchema, manifestSchema } from "@/lib/pipeline/extract/ground-truth";

const root = path.resolve("samples");
const manifest = manifestSchema.parse(JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")));

describe("samples manifest", () => {
  it("lists at least the three foundation samples", () => {
    const names = manifest.map((m) => m.name);
    for (const n of ["clean-digital", "mismatch-total", "not-an-invoice"]) expect(names).toContain(n);
  });
  for (const entry of manifest) {
    it(`${entry.name}: file hash matches and ground truth parses`, () => {
      const bytes = readFileSync(path.join(root, "out", entry.file));
      expect(sha256Hex(new Uint8Array(bytes))).toBe(entry.sha256);
      const gt = groundTruthSchema.parse(JSON.parse(readFileSync(path.join(root, "ground-truth", `${entry.name}.json`), "utf8")));
      expect(gt.name).toBe(entry.name);
    });
  }
});
