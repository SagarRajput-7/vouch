import { renderPageAsImage } from "unpdf";
import { StageError } from "@/lib/pipeline/errors";
import { PARSE_LIMITS } from "./limits";
import { openPdf, type PdfDocument } from "./pdfjs";
import { withTimeout } from "./timeout";

async function render(doc: PdfDocument, pageNo: number, scale: number): Promise<Uint8Array> {
  try {
    const png = await withTimeout(
      renderPageAsImage(doc, pageNo, { canvasImport: () => import("@napi-rs/canvas"), scale }),
      PARSE_LIMITS.pdfOperationTimeoutMs,
      `page ${pageNo} render`,
    );
    return new Uint8Array(png);
  } catch (err) {
    // A timeout is already the specific, non-retryable answer; do not relabel it "unsupported".
    if (err instanceof StageError) throw err;
    throw new StageError("scan_unsupported", "This scanned PDF uses a format Vouch cannot render.", err instanceof Error ? err.message : String(err), { retryable: false });
  }
}

/**
 * Renders one page to PNG bytes for OCR. Pass an already-open document when rendering several
 * pages of the same file: handing over raw bytes re-parses the whole PDF for every page.
 */
export async function renderPagePng(source: Uint8Array | PdfDocument, pageNo: number, scale: number): Promise<Uint8Array> {
  if (!(source instanceof Uint8Array)) return render(source, pageNo, scale);
  const doc = await openPdf(source);
  try {
    return await render(doc, pageNo, scale);
  } finally {
    await doc.loadingTask.destroy();
  }
}
