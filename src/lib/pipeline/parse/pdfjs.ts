import { definePDFJSModule, getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { StageError } from "@/lib/pipeline/errors";
import { PARSE_LIMITS } from "./limits";
import { withTimeout } from "./timeout";

let ready: Promise<void> | undefined;

/**
 * unpdf bundles a serverless pdf.js build that extracts text without worker files. Rendering
 * pages to images needs the official build plus a canvas, and unpdf lets one module choice
 * serve both, so it is made once per process before any document is opened.
 */
export function ensurePdfjs(): Promise<void> {
  ready ??= Promise.resolve(definePDFJSModule(() => import("pdfjs-dist"))).then(() => undefined);
  return ready;
}

/** Opens a PDF, translating pdf.js failures into fatal stage errors with plain messages. */
export async function openPdf(bytes: Uint8Array) {
  await ensurePdfjs();
  try {
    // pdf.js may take ownership of the buffer it is handed; always pass a copy. verbosity 0 keeps
    // its font-substitution chatter (several lines per rendered page) out of the logs; real
    // failures still arrive as exceptions.
    return await withTimeout(getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 }), PARSE_LIMITS.pdfOperationTimeoutMs, "open document");
  } catch (err) {
    // A timeout is already the specific, non-retryable answer; do not relabel it "unreadable".
    if (err instanceof StageError) throw err;
    const name = err instanceof Error ? err.name : "";
    const detail = err instanceof Error ? err.message : String(err);
    if (name === "PasswordException") {
      throw new StageError("pdf_encrypted", "This PDF is password protected. Remove the password and upload it again.", detail, { retryable: false });
    }
    throw new StageError("pdf_unreadable", "This PDF could not be read. It may be damaged.", detail, { retryable: false });
  }
}

/** An open pdf.js document. Callers must destroy it through `doc.loadingTask.destroy()`. */
export type PdfDocument = Awaited<ReturnType<typeof openPdf>>;

/**
 * The operators that paint an image. A page with almost no text is only worth rasterising and
 * OCRing when it actually draws something; a blank or separator page draws nothing.
 */
export async function imagePaintOps(): Promise<ReadonlySet<number>> {
  await ensurePdfjs();
  const { OPS } = await getResolvedPDFJS();
  return new Set([OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]);
}
