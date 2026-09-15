import { mkdir } from "node:fs/promises";
import { createWorker, type Worker } from "tesseract.js";
import type { PositionedToken } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { assignLines, type RawToken } from "./lines";

export type OcrResult = { tokens: PositionedToken[]; meanConfidence: number };

type Bbox = { x0: number; y0: number; x1: number; y1: number };
type Word = { text: string; confidence: number; bbox: Bbox };
export type OcrBlock = { paragraphs: Array<{ lines: Array<{ words: Word[] }> }> };

/** Language data is fetched once from the default CDN and cached here. Vercel only allows writes under /tmp. */
export function tessdataDir(): string {
  return env.TESSDATA_CACHE_DIR ?? (process.env.VERCEL ? "/tmp/tessdata" : ".data/tessdata");
}

export async function createOcrWorker(): Promise<Worker> {
  const cachePath = tessdataDir();
  await mkdir(cachePath, { recursive: true });
  // oem 1 selects the LSTM engine, the only one shipped in the default language data.
  return createWorker("eng", 1, { cachePath, logger: () => undefined, errorHandler: () => undefined });
}

/** Converts Tesseract's block tree to normalised tokens with a mean word confidence in [0, 1]. */
export function tokensFromBlocks(blocks: OcrBlock[], size: { width: number; height: number }): OcrResult {
  const raw: RawToken[] = [];
  const confidences: number[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const text = word.text.trim();
          if (!text) continue;
          raw.push({
            text,
            x: word.bbox.x0 / size.width,
            y: word.bbox.y0 / size.height,
            w: (word.bbox.x1 - word.bbox.x0) / size.width,
            h: (word.bbox.y1 - word.bbox.y0) / size.height,
          });
          confidences.push(word.confidence / 100);
        }
      }
    }
  }
  const meanConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  return { tokens: assignLines(raw), meanConfidence };
}

/**
 * Recognises one image. Returns null when the page takes longer than the timeout; the caller
 * must then terminate the worker, since a running recognise cannot be cancelled.
 */
export async function recognisePage(worker: Worker, image: Uint8Array, size: { width: number; height: number }, timeoutMs: number): Promise<OcrResult | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  // A recognise that fails after the race has settled would otherwise be an unhandled rejection,
  // which Node treats as fatal. The caller terminates the worker on timeout, which makes that
  // late failure the expected path, so it is observed here and ignored.
  const work = worker.recognize(Buffer.from(image), {}, { blocks: true });
  work.catch(() => undefined);
  try {
    const result = await Promise.race([work, timeout]);
    if (result === null) return null;
    return tokensFromBlocks((result.data.blocks ?? []) as OcrBlock[], size);
  } finally {
    clearTimeout(timer);
  }
}
