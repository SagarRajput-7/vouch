import type { PositionedToken } from "@/lib/db/schema";
import { StageError } from "@/lib/pipeline/errors";
import type { ParsedPage } from "@/lib/pipeline/types";
import { openPdf } from "./pdfjs";

type TextItem = { str: string; transform: number[]; width: number; height: number };
type Viewport = { width: number; height: number; rotation: number; convertToViewportPoint(x: number, y: number): number[] };
type RawToken = Omit<PositionedToken, "line">;

export type PdfTextResult = { pageCount: number; pages: ParsedPage[] };

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Groups tokens into reading-order lines by baseline proximity, then sorts each line left to right. */
export function assignLines(tokens: RawToken[]): PositionedToken[] {
  const sorted = [...tokens].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: PositionedToken[] = [];
  let line = -1;
  let lineY = Number.NEGATIVE_INFINITY;
  let lineH = 0;
  for (const t of sorted) {
    const tolerance = Math.max(t.h, lineH) * 0.5;
    if (Math.abs(t.y - lineY) > tolerance) {
      line += 1;
      lineY = t.y;
      lineH = t.h;
    }
    out.push({ ...t, line });
  }
  return out.sort((a, b) => a.line - b.line || a.x - b.x);
}

/**
 * Splits one pdf.js text item into word tokens. pdf.js reports the item's origin at the left
 * end of its baseline in PDF user space (y grows upward); the viewport converts that to
 * top-left pixel space with the page rotation applied. Each word takes a share of the item's
 * width proportional to its character count, which is close enough for highlight boxes.
 */
function wordsFrom(item: TextItem, viewport: Viewport): RawToken[] {
  const text = item.str;
  if (!text.trim() || item.width <= 0 || item.height <= 0) return [];
  const originX = item.transform[4];
  const originY = item.transform[5];
  const boxOf = (offset: number, width: number): Omit<RawToken, "text"> => {
    const corners = [
      viewport.convertToViewportPoint(originX + offset, originY),
      viewport.convertToViewportPoint(originX + offset + width, originY),
      viewport.convertToViewportPoint(originX + offset, originY + item.height),
      viewport.convertToViewportPoint(originX + offset + width, originY + item.height),
    ];
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x: clamp01(x / viewport.width),
      y: clamp01(y / viewport.height),
      w: clamp01((Math.max(...xs) - x) / viewport.width),
      h: clamp01((Math.max(...ys) - y) / viewport.height),
    };
  };
  const out: RawToken[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const offset = (m.index / text.length) * item.width;
    const width = (m[0].length / text.length) * item.width;
    out.push({ text: m[0], ...boxOf(offset, width) });
  }
  return out;
}

export async function extractPdfText(bytes: Uint8Array, maxPages: number): Promise<PdfTextResult> {
  const pdf = await openPdf(bytes);
  try {
    if (pdf.numPages > maxPages) {
      throw new StageError("too_many_pages", `Documents are limited to ${maxPages} pages. This one has ${pdf.numPages}.`, undefined, { retryable: false });
    }
    const pages: ParsedPage[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: 1 }) as unknown as Viewport;
      const content = await page.getTextContent();
      const tokens = (content.items as unknown[])
        .filter((i): i is TextItem => typeof i === "object" && i !== null && "str" in i && "transform" in i)
        .flatMap((i) => wordsFrom(i, viewport));
      pages.push({
        pageNo,
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation,
        textSource: tokens.length > 0 ? "pdf" : "none",
        ocrMeanConfidence: null,
        tokens: assignLines(tokens),
      });
      page.cleanup();
    }
    return { pageCount: pdf.numPages, pages };
  } finally {
    // pdf.js 6 moved document teardown onto the loading task; destroying it also stops the worker.
    await pdf.loadingTask.destroy();
  }
}
