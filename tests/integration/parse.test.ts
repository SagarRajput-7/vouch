import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { imageSize } from "@/lib/pipeline/parse/image-size";
import { assignLines, extractPdfText } from "@/lib/pipeline/parse/pdf-text";
import { renderPagePng } from "@/lib/pipeline/parse/raster";

const sample = (name: string) => readFile(path.resolve("samples/out", name)).then((b) => new Uint8Array(b));

describe("extractPdfText", () => {
  it("returns normalised word tokens in reading order for a digital PDF", async () => {
    const { pageCount, pages } = await extractPdfText(await sample("clean-digital.pdf"), 10);
    expect(pageCount).toBe(1);
    const [page] = pages;
    expect(page.pageNo).toBe(1);
    expect(page.textSource).toBe("pdf");
    expect(page.height).toBeGreaterThan(page.width);
    const texts = page.tokens.map((t) => t.text);
    expect(texts).toContain("Halcyon");
    expect(texts).toContain("1,764.48");
    for (const t of page.tokens) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(1.0001);
      expect(t.y + t.h).toBeLessThanOrEqual(1.0001);
      expect(t.w).toBeGreaterThan(0);
      expect(t.h).toBeGreaterThan(0);
    }
    const vendor = page.tokens.find((t) => t.text === "Halcyon")!;
    const total = page.tokens.find((t) => t.text === "1,764.48")!;
    // y grows downward: the vendor heading sits above the totals block.
    expect(vendor.y).toBeLessThan(total.y);
    expect(vendor.line).toBeLessThan(total.line);
  });

  it("rejects a document over the page limit without retrying", async () => {
    await expect(extractPdfText(await sample("clean-digital.pdf"), 0)).rejects.toMatchObject({ code: "too_many_pages", retryable: false });
  });

  it("fails fast on bytes that only pretend to be a PDF", async () => {
    await expect(extractPdfText(new TextEncoder().encode("%PDF-1.4 nonsense"), 10)).rejects.toMatchObject({ code: "pdf_unreadable", retryable: false });
  });
});

describe("assignLines", () => {
  it("groups tokens by baseline and orders each line left to right", () => {
    const tokens = assignLines([
      { text: "b", x: 0.5, y: 0.1, w: 0.1, h: 0.02 },
      { text: "a", x: 0.1, y: 0.105, w: 0.1, h: 0.02 },
      { text: "c", x: 0.1, y: 0.2, w: 0.1, h: 0.02 },
    ]);
    expect(tokens.map((t) => `${t.line}:${t.text}`)).toEqual(["0:a", "0:b", "1:c"]);
  });
});

describe("renderPagePng", () => {
  it("renders page 1 to a PNG sized by the scale", async () => {
    const bytes = await sample("clean-digital.pdf");
    const { pages } = await extractPdfText(bytes, 10);
    const png = await renderPagePng(bytes, 1, 2);
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const size = await imageSize(png);
    expect(Math.abs(size.width - pages[0].width * 2)).toBeLessThan(2);
    expect(Math.abs(size.height - pages[0].height * 2)).toBeLessThan(2);
  });

  it("reports an unrenderable page as a fatal stage error", async () => {
    await expect(renderPagePng(await sample("clean-digital.pdf"), 7, 2)).rejects.toMatchObject({ code: "scan_unsupported", retryable: false });
  });
});
