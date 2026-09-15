export const PARSE_LIMITS = {
  maxPages: 10,
  ocrMaxPages: 5,
  ocrPageTimeoutMs: 25_000,
  /** 2 renders A4 at roughly 150 dpi, enough for OCR without huge images. */
  rasterScale: 2,
  /** Pages with fewer readable tokens than this are treated as image-only and sent to OCR. */
  minTextTokens: 20,
} as const;
