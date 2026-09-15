import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Worker } from "tesseract.js";
import { describe, expect, it } from "vitest";
import { startGuestSession } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { sha256Hex } from "@/lib/files/hash";
import { renderPagePng } from "@/lib/pipeline/parse/raster";
import { ocrPages, parseStage } from "@/lib/pipeline/stages/parse";
import type { ParsedPage, StageContext } from "@/lib/pipeline/types";
import { documentsRepo } from "@/lib/repo/documents";
import { pagesRepo } from "@/lib/repo/pages";

const sample = (name: string) => readFile(path.resolve("samples/out", name)).then((b) => new Uint8Array(b));

async function seed(name: string, mime: string): Promise<StageContext> {
  const bytes = await sample(name);
  const sha = sha256Hex(bytes);
  const { info } = await startGuestSession();
  const blobKey = `${info.workspaceId}/${sha}-${name}`;
  await getBlobStore().put(blobKey, bytes, mime);
  const document = await documentsRepo.create({
    workspaceId: info.workspaceId,
    originalFilename: name,
    mime,
    byteSize: bytes.length,
    sha256: sha,
    blobKey,
  });
  return { documentId: document.id, workspaceId: info.workspaceId, jobId: "job-parse-test", document, state: {} };
}

const blankPage = (): ParsedPage => ({ pageNo: 1, width: 100, height: 200, rotation: 0, textSource: "none", ocrMeanConfidence: null, tokens: [] });

describe("parseStage", () => {
  it("writes one page of PDF text and replaces it on a second run", async () => {
    const ctx = await seed("clean-digital.pdf", "application/pdf");
    const outcome = await parseStage.run(ctx);

    expect(outcome.meta).toEqual({ kind: "pdf_text", pages: 1, textPages: 1, ocrPages: 0, unreadablePages: 0, meanOcrConfidence: null });
    const rows = await pagesRepo.listByDocument(ctx.documentId);
    expect(rows).toHaveLength(1);
    expect(rows[0].textSource).toBe("pdf");
    expect(rows[0].tokens.length).toBeGreaterThan(50);
    expect(rows[0].ocrMeanConfidence).toBeNull();
    expect(ctx.state.pages).toHaveLength(1);

    const document = await documentsRepo.getByIdUnscoped(ctx.documentId);
    expect(document?.kind).toBe("pdf_text");
    expect(document?.pageCount).toBe(1);

    await parseStage.run(ctx);
    expect(await pagesRepo.listByDocument(ctx.documentId)).toHaveLength(1);
  }, 60_000);

  it("OCRs an image-only PDF page and records it as a scan", async () => {
    const ctx = await seed("scan-lowres.pdf", "application/pdf");
    const outcome = await parseStage.run(ctx);

    expect(outcome.meta).toMatchObject({ kind: "pdf_scan", pages: 1, textPages: 0, ocrPages: 1, unreadablePages: 0 });
    const [row] = await pagesRepo.listByDocument(ctx.documentId);
    expect(row.textSource).toBe("ocr");
    expect(row.tokens.length).toBeGreaterThan(10);
    expect(row.ocrMeanConfidence).toBeGreaterThan(0);
    expect((await documentsRepo.getByIdUnscoped(ctx.documentId))?.kind).toBe("pdf_scan");
  }, 180_000);
});

describe("ocrPages", () => {
  it("marks a page unreadable when recognition fails instead of failing the document", async () => {
    const png = await renderPagePng(await sample("clean-digital.pdf"), 1, 2);
    const page = blankPage();
    let terminated = 0;
    const worker = {
      recognize: () => Promise.reject(new Error("wasm exploded")),
      terminate: async () => {
        terminated += 1;
      },
    } as unknown as Worker;

    await ocrPages([{ page, image: async () => png }], async () => worker);

    expect(page.textSource).toBe("none");
    expect(page.tokens).toEqual([]);
    expect(page.ocrMeanConfidence).toBeNull();
    expect(terminated).toBe(1);
  }, 60_000);

  it("marks a page unreadable when recognition returns no words", async () => {
    const png = await renderPagePng(await sample("clean-digital.pdf"), 1, 2);
    const page = blankPage();
    const worker = {
      recognize: async () => ({ data: { blocks: [] } }),
      terminate: async () => undefined,
    } as unknown as Worker;

    await ocrPages([{ page, image: async () => png }], async () => worker);

    expect(page.textSource).toBe("none");
    expect(page.ocrMeanConfidence).toBeNull();
  }, 60_000);

  it("marks every page unreadable when the worker cannot start", async () => {
    const pages = [blankPage(), { ...blankPage(), pageNo: 2 }];
    let attempts = 0;
    const failing = async (): Promise<Worker> => {
      attempts += 1;
      throw new Error("language data unavailable");
    };

    await ocrPages(
      pages.map((page) => ({ page, image: async () => new Uint8Array() })),
      failing,
    );

    expect(pages.every((p) => p.textSource === "none" && p.tokens.length === 0)).toBe(true);
    expect(attempts).toBe(1);
  });
});
