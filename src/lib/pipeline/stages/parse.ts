import type { Worker } from "tesseract.js";
import { getBlobStore } from "@/lib/blob";
import { StageError } from "@/lib/pipeline/errors";
import { imageSize } from "@/lib/pipeline/parse/image-size";
import { PARSE_LIMITS } from "@/lib/pipeline/parse/limits";
import { createOcrWorker, recognisePage } from "@/lib/pipeline/parse/ocr";
import { extractPdfText } from "@/lib/pipeline/parse/pdf-text";
import { renderPagePng } from "@/lib/pipeline/parse/raster";
import type { ParsedPage, Stage } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { pagesRepo } from "@/lib/repo/pages";

type OcrItem = { page: ParsedPage; image: () => Promise<Uint8Array> };

function readableTokens(page: ParsedPage): number {
  return page.tokens.filter((t) => /[\p{L}\p{N}]/u.test(t.text)).length;
}

/** OCRs pages in order with one worker, replacing it after a timeout because a stuck recognise cannot be cancelled. */
async function ocrPages(items: OcrItem[]): Promise<void> {
  let worker: Worker | null = null;
  try {
    for (const { page, image } of items) {
      worker ??= await createOcrWorker();
      const png = await image();
      const size = await imageSize(png);
      const result = await recognisePage(worker, png, size, PARSE_LIMITS.ocrPageTimeoutMs);
      if (result === null) {
        await worker.terminate().catch(() => undefined);
        worker = null;
        page.textSource = "none";
        page.ocrMeanConfidence = null;
        page.tokens = [];
        continue;
      }
      page.tokens = result.tokens;
      page.textSource = "ocr";
      page.ocrMeanConfidence = result.meanConfidence;
    }
  } finally {
    if (worker) await worker.terminate().catch(() => undefined);
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
      pages = (await extractPdfText(blob.bytes, PARSE_LIMITS.maxPages)).pages;
      const scans = pages.filter((p) => readableTokens(p) < PARSE_LIMITS.minTextTokens);
      for (const p of scans) {
        p.tokens = [];
        p.textSource = "none";
      }
      kind = scans.length === 0 ? "pdf_text" : "pdf_scan";
      await ocrPages(
        scans.slice(0, PARSE_LIMITS.ocrMaxPages).map((page) => ({ page, image: () => renderPagePng(blob.bytes, page.pageNo, PARSE_LIMITS.rasterScale) })),
      );
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
