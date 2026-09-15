import type { Worker } from "tesseract.js";
import { getBlobStore } from "@/lib/blob";
import { errorMessage, log } from "@/lib/logger";
import { StageError } from "@/lib/pipeline/errors";
import { imageSize } from "@/lib/pipeline/parse/image-size";
import { PARSE_LIMITS } from "@/lib/pipeline/parse/limits";
import { createOcrWorker, recognisePage } from "@/lib/pipeline/parse/ocr";
import { extractPdfText, readableTokens } from "@/lib/pipeline/parse/pdf-text";
import { openPdf } from "@/lib/pipeline/parse/pdfjs";
import { renderPagePng } from "@/lib/pipeline/parse/raster";
import type { ParsedPage, Stage } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { pagesRepo } from "@/lib/repo/pages";

export type OcrItem = { page: ParsedPage; image: () => Promise<Uint8Array> };

/** A page nobody can read: no tokens, no confidence, and the grounding stage will skip it. */
function markUnreadable(page: ParsedPage): void {
  page.tokens = [];
  page.textSource = "none";
  page.ocrMeanConfidence = null;
}

/**
 * OCRs pages in order with one worker. A page that times out, fails, or comes back with no words
 * is recorded as unreadable and the document carries on: one bad page must not cost the other
 * nine. The worker is replaced after a timeout (a stuck recognise cannot be cancelled) and after a
 * hard failure (its state is unknown), but kept when the page was simply blank.
 */
export async function ocrPages(items: OcrItem[], startWorker: () => Promise<Worker> = createOcrWorker): Promise<void> {
  let worker: Worker | null = null;
  const stop = async (w: Worker) => {
    await w.terminate().catch(() => undefined);
  };
  try {
    for (let i = 0; i < items.length; i += 1) {
      const { page, image } = items[i];
      if (worker === null) {
        try {
          worker = await startWorker();
        } catch (err) {
          // Usually the language data could not be fetched, which every later page would hit too.
          log.warn("ocr.worker_unavailable", { pageNo: page.pageNo, error: errorMessage(err) });
          for (const rest of items.slice(i)) markUnreadable(rest.page);
          return;
        }
      }
      // Held separately so the catch below still has the worker this page ran on.
      const active = worker;
      try {
        const png = await image();
        const size = await imageSize(png);
        const result = await recognisePage(active, png, size, PARSE_LIMITS.ocrPageTimeoutMs);
        if (result === null) {
          log.warn("ocr.page_timeout", { pageNo: page.pageNo, timeoutMs: PARSE_LIMITS.ocrPageTimeoutMs });
          await stop(active);
          worker = null;
          markUnreadable(page);
        } else if (result.tokens.length === 0) {
          log.warn("ocr.page_empty", { pageNo: page.pageNo });
          markUnreadable(page);
        } else {
          page.tokens = result.tokens;
          page.textSource = "ocr";
          page.ocrMeanConfidence = result.meanConfidence;
        }
      } catch (err) {
        log.warn("ocr.page_failed", { pageNo: page.pageNo, error: errorMessage(err) });
        await stop(active);
        worker = null;
        markUnreadable(page);
      }
    }
  } finally {
    if (worker) await stop(worker);
  }
}

export const parseStage: Stage = {
  name: "parse",
  async run(ctx) {
    const blob = await getBlobStore().get(ctx.document.blobKey);
    if (!blob) throw new StageError("blob_missing", "The stored file could not be read.");

    let pages: ParsedPage[];
    let kind: "pdf_text" | "pdf_scan" | "image";
    if (ctx.document.mime === "application/pdf") {
      const parsed = await extractPdfText(blob.bytes, PARSE_LIMITS.maxPages, PARSE_LIMITS.minTextTokens);
      pages = parsed.pages;
      // Too little text to ground on: the page starts unreadable, and only the ones that paint an
      // image are worth rasterising. A blank page or a separator would burn the OCR budget for nothing.
      for (const page of pages) {
        if (readableTokens(page.tokens) < PARSE_LIMITS.minTextTokens) markUnreadable(page);
      }
      const textPages = pages.filter((p) => p.textSource === "pdf").length;
      // One near-blank page in a digital invoice does not make the whole document a scan.
      kind = parsed.imageOnlyPages.length > textPages ? "pdf_scan" : "pdf_text";
      const scans = new Set(parsed.imageOnlyPages);
      const candidates = pages.filter((p) => scans.has(p.pageNo)).slice(0, PARSE_LIMITS.ocrMaxPages);
      if (candidates.length > 0) {
        // Opened once for every rendered page: handing bytes to the renderer re-parses the whole PDF.
        const doc = await openPdf(blob.bytes);
        try {
          await ocrPages(candidates.map((page) => ({ page, image: () => renderPagePng(doc, page.pageNo, PARSE_LIMITS.rasterScale) })));
        } finally {
          await doc.loadingTask.destroy();
        }
      }
    } else {
      const size = await imageSize(blob.bytes);
      const page: ParsedPage = { pageNo: 1, width: size.width, height: size.height, rotation: 0, textSource: "none", ocrMeanConfidence: null, tokens: [] };
      pages = [page];
      kind = "image";
      await ocrPages([{ page, image: async () => blob.bytes }]);
    }

    await pagesRepo.replaceForDocument(ctx.documentId, pages);
    await documentsRepo.update(ctx.documentId, { kind, pageCount: pages.length });
    ctx.state.pages = pages;

    const ocr = pages.filter((p) => p.textSource === "ocr");
    return {
      meta: {
        kind,
        pages: pages.length,
        textPages: pages.filter((p) => p.textSource === "pdf").length,
        ocrPages: ocr.length,
        unreadablePages: pages.filter((p) => p.textSource === "none").length,
        meanOcrConfidence: ocr.length ? ocr.reduce((sum, p) => sum + (p.ocrMeanConfidence ?? 0), 0) / ocr.length : null,
      },
    };
  },
};
