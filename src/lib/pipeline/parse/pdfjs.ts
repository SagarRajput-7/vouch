import { definePDFJSModule, getDocumentProxy } from "unpdf";
import { StageError } from "@/lib/pipeline/errors";

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
    // pdf.js may take ownership of the buffer it is handed; always pass a copy.
    return await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const detail = err instanceof Error ? err.message : String(err);
    if (name === "PasswordException") {
      throw new StageError("pdf_encrypted", "This PDF is password protected. Remove the password and upload it again.", detail, { retryable: false });
    }
    throw new StageError("pdf_unreadable", "This PDF could not be read. It may be damaged.", detail, { retryable: false });
  }
}
