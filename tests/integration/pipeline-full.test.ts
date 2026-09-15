import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startGuestSession } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { getDb } from "@/lib/db/client";
import { sha256Hex } from "@/lib/files/hash";
import { setModelProviderForTests } from "@/lib/pipeline/extract/model";
import { runJob } from "@/lib/pipeline/runner";
import { claimJobs } from "@/lib/queue/claim";
import { documentsRepo } from "@/lib/repo/documents";
import { invoicesRepo } from "@/lib/repo/invoices";
import { issuesRepo } from "@/lib/repo/issues";
import { jobsRepo } from "@/lib/repo/jobs";
import { pagesRepo } from "@/lib/repo/pages";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

type Seeded = { workspaceId: string; docId: string; jobId: string };

async function seed(file: string, bytes?: Uint8Array): Promise<Seeded> {
  const { info } = await startGuestSession();
  const data = bytes ?? new Uint8Array(await readFile(path.resolve("samples/out", file)));
  const sha = sha256Hex(data);
  const mime = file.endsWith(".jpg") ? "image/jpeg" : "application/pdf";
  const blobKey = `${info.workspaceId}/${sha}.${file.endsWith(".jpg") ? "jpg" : "pdf"}`;
  await getBlobStore().put(blobKey, data, mime);
  const doc = await documentsRepo.create({ workspaceId: info.workspaceId, originalFilename: file, mime, byteSize: data.length, sha256: sha, blobKey, kind: mime === "image/jpeg" ? "image" : "unknown" });
  const job = await jobsRepo.enqueue({ workspaceId: info.workspaceId, documentId: doc.id, kind: "process_document" });
  return { workspaceId: info.workspaceId, docId: doc.id, jobId: job.id };
}

afterEach(() => setModelProviderForTests(null));

describe("full pipeline in mock mode", () => {
  it("parses, extracts, grounds, validates and finalises a clean digital invoice, idempotently", async () => {
    const s = await seed("clean-digital.pdf");
    await runJob((await jobsRepo.getById(s.jobId))!);
    const doc = await documentsRepo.getByIdUnscoped(s.docId);
    expect(doc).toMatchObject({ status: "needs_review", kind: "pdf_text", pageCount: 1, docType: "invoice" });
    const stored = (await invoicesRepo.getByDocument(s.workspaceId, s.docId))!;
    expect(stored.invoice.total).toBe("1764.48");
    expect(stored.invoice.vendorKey).toBe("halcyon cloud services");
    expect(stored.invoice.fields.total).toMatchObject({ groundingMethod: "exact", page: 1 });
    expect(stored.invoice.fields.total.bbox).not.toBeNull();
    expect(stored.invoice.fields.total.risk).toBeLessThan(0.2);
    expect(stored.lineItems).toHaveLength(3);
    expect(stored.lineItems[1].meta.amount?.bbox).not.toBeNull();
    expect(await issuesRepo.listByDocument(s.docId)).toEqual([]);
    expect((await pagesRepo.listByDocument(s.docId))[0].textSource).toBe("pdf");
    expect((await pipelineRunsRepo.listByDocument(s.docId)).map((r) => `${r.stage}:${r.status}`)).toEqual([
      "parse:succeeded", "extract:succeeded", "ground:succeeded", "validate:succeeded", "reconcile:succeeded", "finalise:succeeded",
    ]);
    const [hit] = await getDb().execute<{ n: string }>(sql`select count(*) as n from invoices where search @@ plainto_tsquery('simple', 'halcyon')`).then((r) => (Array.isArray(r) ? r : (r as { rows: { n: string }[] }).rows));
    expect(Number(hit.n)).toBe(1);

    const runsBefore = (await pipelineRunsRepo.listByDocument(s.docId)).length;
    await jobsRepo.requeue(s.jobId);
    await runJob((await jobsRepo.getById(s.jobId))!);
    expect((await pipelineRunsRepo.listByDocument(s.docId)).length).toBe(runsBefore);
  });

  it("surfaces the arithmetic error of the mismatch sample as a blocking issue on the total", async () => {
    const s = await seed("mismatch-total.pdf");
    await runJob((await jobsRepo.getById(s.jobId))!);
    const stored = (await invoicesRepo.getByDocument(s.workspaceId, s.docId))!;
    expect(stored.invoice.total).toBe("719.70");
    expect(stored.invoice.fields.total.risk).toBeGreaterThanOrEqual(0.5);
    expect(stored.invoice.fields.vendorName.risk).toBeLessThan(0.2);
    const issues = await issuesRepo.listByDocument(s.docId);
    expect(issues.map((i) => i.code)).toEqual(["V003"]);
    expect(issues[0].suggestion).toMatchObject({ fieldPath: "total", value: "791.70" });
    const reconcile = (await pipelineRunsRepo.listByDocument(s.docId)).find((r) => r.stage === "reconcile");
    expect(reconcile?.meta).toMatchObject({ adopted: false });
  });

  it("rejects the bank statement after parse and extract", async () => {
    const s = await seed("not-an-invoice.pdf");
    await runJob((await jobsRepo.getById(s.jobId))!);
    const doc = await documentsRepo.getByIdUnscoped(s.docId);
    expect(doc).toMatchObject({ status: "rejected", failureCode: "not_an_invoice" });
    expect((await pipelineRunsRepo.listByDocument(s.docId)).map((r) => r.stage)).toEqual(["parse", "extract"]);
    expect((await issuesRepo.listByDocument(s.docId)).map((i) => i.code)).toEqual(["V011"]);
  });

  it("reads a phone photo with OCR and grounds the headline values", async () => {
    const s = await seed("scan-photo.jpg");
    await runJob((await jobsRepo.getById(s.jobId))!);
    const doc = await documentsRepo.getByIdUnscoped(s.docId);
    expect(doc).toMatchObject({ status: "needs_review", kind: "image", pageCount: 1 });
    const [page] = await pagesRepo.listByDocument(s.docId);
    expect(page.textSource).toBe("ocr");
    expect(page.ocrMeanConfidence).toBeGreaterThan(0.4);
    const stored = (await invoicesRepo.getByDocument(s.workspaceId, s.docId))!;
    const located = ["vendorName", "invoiceNumber", "total"].filter((f) => stored.invoice.fields[f].bbox !== null);
    expect(located.length).toBeGreaterThanOrEqual(2);
  }, 180_000);

  it("reads a low-resolution scanned PDF and continues even when values do not ground", async () => {
    const s = await seed("scan-lowres.pdf");
    await runJob((await jobsRepo.getById(s.jobId))!);
    const doc = await documentsRepo.getByIdUnscoped(s.docId);
    expect(doc).toMatchObject({ status: "needs_review", kind: "pdf_scan" });
    const [page] = await pagesRepo.listByDocument(s.docId);
    expect(page.textSource).toBe("ocr");
    const stored = (await invoicesRepo.getByDocument(s.workspaceId, s.docId))!;
    expect(stored.invoice.total).toBe("280.50");
  }, 180_000);

  it("fails a corrupt PDF on the first attempt with a specific message", async () => {
    const s = await seed("broken.pdf", new TextEncoder().encode("%PDF-1.4 this is not really a pdf"));
    const [claimed] = await claimJobs({ runnerId: "t", limit: 1, perWorkspace: 5, global: 5 });
    await runJob(claimed);
    const doc = await documentsRepo.getByIdUnscoped(s.docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureCode).toBe("pdf_unreadable");
    expect((await jobsRepo.getById(s.jobId))?.status).toBe("dead");
  });

  it("retries a transient failure and marks the document failed when attempts run out", async () => {
    const s = await seed("clean-digital.pdf");
    setModelProviderForTests({
      name: "boom",
      extract: async () => {
        throw new Error("model exploded");
      },
    });
    for (let i = 0; i < 3; i += 1) {
      await getDb().execute(sql`update jobs set run_after = now() - interval '1 second' where id = ${s.jobId}`);
      const [claimed] = await claimJobs({ runnerId: "t", limit: 1, perWorkspace: 5, global: 5 });
      await runJob(claimed);
    }
    expect((await jobsRepo.getById(s.jobId))?.status).toBe("dead");
    const doc = await documentsRepo.getByIdUnscoped(s.docId);
    expect(doc?.status).toBe("failed");
    expect(doc?.failureMessage).toBe("Processing failed. Try again.");
    // parse succeeded on the first attempt and is never repeated
    expect((await pipelineRunsRepo.listByDocument(s.docId)).filter((r) => r.stage === "parse")).toHaveLength(1);
  });
});
