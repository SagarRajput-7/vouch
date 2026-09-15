import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { imageSize } from "@/lib/pipeline/parse/image-size";
import { createOcrWorker, recognisePage, tokensFromBlocks } from "@/lib/pipeline/parse/ocr";
import { renderPagePng } from "@/lib/pipeline/parse/raster";

const sample = (name: string) => readFile(path.resolve("samples/out", name)).then((b) => new Uint8Array(b));

describe("tokensFromBlocks", () => {
  it("normalises word boxes and averages confidence", () => {
    const blocks = [
      { paragraphs: [{ lines: [{ words: [
        { text: "Total", confidence: 90, bbox: { x0: 100, y0: 200, x1: 160, y1: 220 } },
        { text: "1,764.48", confidence: 70, bbox: { x0: 400, y0: 200, x1: 500, y1: 220 } },
        { text: " ", confidence: 0, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
      ] }] }] },
    ];
    const out = tokensFromBlocks(blocks, { width: 1000, height: 2000 });
    expect(out.tokens).toHaveLength(2);
    expect(out.tokens[0]).toEqual({ text: "Total", x: 0.1, y: 0.1, w: 0.06, h: 0.01, line: 0 });
    expect(out.tokens[1].line).toBe(0);
    expect(out.meanConfidence).toBeCloseTo(0.8, 5);
  });
});

describe("ocr", () => {
  it("reads words with boxes and confidence from a rendered page", async () => {
    const bytes = await sample("clean-digital.pdf");
    const png = await renderPagePng(bytes, 1, 2);
    const size = await imageSize(png);
    const worker = await createOcrWorker();
    try {
      const result = await recognisePage(worker, png, size, 60_000);
      expect(result).not.toBeNull();
      expect(result!.meanConfidence).toBeGreaterThan(0.6);
      const texts = result!.tokens.map((t) => t.text);
      const joined = texts.join(" ");
      expect(texts).toContain("Halcyon");
      expect(joined).toContain("HCS");
      expect(joined).toContain("2026");
      expect(result!.tokens.every((t) => t.x >= 0 && t.x + t.w <= 1.001 && t.y >= 0 && t.y + t.h <= 1.001)).toBe(true);
    } finally {
      await worker.terminate();
    }
  }, 180_000);

  it("returns null when recognition exceeds the timeout", async () => {
    const worker = await createOcrWorker();
    try {
      const png = await renderPagePng(await sample("clean-digital.pdf"), 1, 2);
      const result = await recognisePage(worker, png, await imageSize(png), 1);
      expect(result).toBeNull();
    } finally {
      await worker.terminate();
    }
  }, 180_000);
});
