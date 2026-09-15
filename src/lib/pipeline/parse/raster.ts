import { renderPageAsImage } from "unpdf";
import { StageError } from "@/lib/pipeline/errors";
import { ensurePdfjs } from "./pdfjs";

/** Renders one page to PNG bytes for OCR. */
export async function renderPagePng(bytes: Uint8Array, pageNo: number, scale: number): Promise<Uint8Array> {
  await ensurePdfjs();
  try {
    const png = await renderPageAsImage(new Uint8Array(bytes), pageNo, { canvasImport: () => import("@napi-rs/canvas"), scale });
    return new Uint8Array(png);
  } catch (err) {
    throw new StageError("scan_unsupported", "This scanned PDF uses a format Vouch cannot render.", err instanceof Error ? err.message : String(err), { retryable: false });
  }
}
