import type { PositionedToken } from "@/lib/db/schema";
import { StageError } from "@/lib/pipeline/errors";
import type { ParsedPage } from "@/lib/pipeline/types";
import { assignLines, type RawToken } from "./lines";
import { PARSE_LIMITS } from "./limits";
import { imagePaintOps, openPdf } from "./pdfjs";
import { withTimeout } from "./timeout";

type TextItem = { str: string; transform: number[]; width: number; height: number };
type Viewport = { width: number; height: number; rotation: number; convertToViewportPoint(x: number, y: number): number[] };

export type PdfTextResult = {
  pageCount: number;
  pages: ParsedPage[];
  /** Pages with too little text to ground on that do paint an image, so OCR has something to read. */
  imageOnlyPages: number[];
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Tokens carrying a letter or a digit: the ones grounding can match. Punctuation alone is noise. */
export function readableTokens(tokens: Array<{ text: string }>): number {
  return tokens.filter((t) => /[\p{L}\p{N}]/u.test(t.text)).length;
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
    // Clamp the extents, not the width and height: clamping those independently could leave a box
    // whose x + w runs past the page edge, and every consumer treats these as fractions of the page.
    const x = clamp01(Math.min(...xs) / viewport.width);
    const y = clamp01(Math.min(...ys) / viewport.height);
    return { x, y, w: clamp01(Math.max(...xs) / viewport.width) - x, h: clamp01(Math.max(...ys) / viewport.height) - y };
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

export async function extractPdfText(bytes: Uint8Array, maxPages: number, minTextTokens: number): Promise<PdfTextResult> {
  const pdf = await openPdf(bytes);
  try {
    if (pdf.numPages > maxPages) {
      throw new StageError("too_many_pages", `Documents are limited to ${maxPages} pages. This one has ${pdf.numPages}.`, undefined, { retryable: false });
    }
    const imageOps = await imagePaintOps();
    const pages: ParsedPage[] = [];
    const imageOnlyPages: number[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      try {
        const viewport = page.getViewport({ scale: 1 }) as unknown as Viewport;
        const content = await withTimeout(page.getTextContent(), PARSE_LIMITS.pdfOperationTimeoutMs, `page ${pageNo} text`);
        const items = (content.items as unknown[]).filter(
          (i): i is TextItem => typeof i === "object" && i !== null && "str" in i && "transform" in i,
        );
        const tokens: PositionedToken[] = assignLines(items.flatMap((i) => wordsFrom(i, viewport)));
        // Reading the operator list is the cheap way to tell a scan from a page that is simply
        // sparse: a photographed invoice paints an image, a blank or separator page paints none.
        if (readableTokens(tokens) < minTextTokens) {
          const { fnArray } = await withTimeout(page.getOperatorList(), PARSE_LIMITS.pdfOperationTimeoutMs, `page ${pageNo} operators`);
          if (fnArray.some((fn) => imageOps.has(fn))) imageOnlyPages.push(pageNo);
        }
        pages.push({
          pageNo,
          width: viewport.width,
          height: viewport.height,
          rotation: viewport.rotation,
          textSource: tokens.length > 0 ? "pdf" : "none",
          ocrMeanConfidence: null,
          tokens,
        });
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: pdf.numPages, pages, imageOnlyPages };
  } finally {
    // pdf.js 6 moved document teardown onto the loading task; destroying it also stops the worker.
    await pdf.loadingTask.destroy();
  }
}
