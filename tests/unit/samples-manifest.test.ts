import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/files/hash";
import { groundTruthSchema, manifestSchema } from "@/lib/pipeline/extract/ground-truth";

const root = path.resolve("samples");
const manifest = manifestSchema.parse(JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")));

describe("samples manifest", () => {
  it("lists all eight samples from the design spec", () => {
    const names = manifest.map((m) => m.name).sort();
    expect(names).toEqual(["clean-digital", "euro-format", "injection", "mismatch-total", "multipage-lineitems", "not-an-invoice", "scan-lowres", "scan-photo"]);
  });
  it("marks the scanned samples so the pipeline exercises OCR", () => {
    expect(manifest.find((m) => m.name === "scan-photo")).toMatchObject({ mime: "image/jpeg", kind: "image", pages: 1 });
    expect(manifest.find((m) => m.name === "scan-lowres")).toMatchObject({ mime: "application/pdf", kind: "pdf_scan", pages: 1 });
    expect(manifest.find((m) => m.name === "multipage-lineitems")).toMatchObject({ kind: "pdf_text", pages: 3 });
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
