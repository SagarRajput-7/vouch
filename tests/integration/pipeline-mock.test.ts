import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { startGuestSession } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { getDb } from "@/lib/db/client";
import { sha256Hex } from "@/lib/files/hash";
import { MockModelProvider } from "@/lib/pipeline/extract/mock-provider";
import { setModelProviderForTests } from "@/lib/pipeline/extract/model";
import type { GroundTruth } from "@/lib/pipeline/extract/ground-truth";
import { runJob } from "@/lib/pipeline/runner";
import { documentsRepo } from "@/lib/repo/documents";
import { invoicesRepo } from "@/lib/repo/invoices";
import { jobsRepo } from "@/lib/repo/jobs";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

const pdfBytes = new TextEncoder().encode("%PDF-1.4 fake invoice bytes");
const sha = sha256Hex(pdfBytes);

const gt: GroundTruth = {
  name: "test-invoice",
  docType: "invoice",
  fields: {
    vendorName: { value: "Halcyon Cloud Services Inc.", page: 1 },
    invoiceNumber: { value: "HCS-2026-0417", page: 1 },
    issueDate: { value: "2026-08-03", display: "Aug 3, 2026", page: 1 },
    dueDate: { value: "2026-09-02", display: "Sep 2, 2026", page: 1 },
    currency: { value: "USD", page: 1 },
    subtotal: { value: "1630.00", display: "1,630.00", page: 1 },
    tax: { value: "134.48", display: "134.48", page: 1 },
    shipping: null,
    discount: null,
    total: { value: "1764.48", display: "1,764.48", page: 1 },
  },
  lineItems: [
    { description: "Pro plan, August 2026", quantity: "1", unitPrice: "1200.00", amount: "1200.00", display: { unitPrice: "1,200.00", amount: "1,200.00" } },
    { description: "Additional seats", quantity: "4", unitPrice: "45.00", amount: "180.00" },
    { description: "Priority support", quantity: "1", unitPrice: "250.00", amount: "250.00" },
  ],
  expectedIssues: [],
};

async function seed(kind: "invoice" | "other") {
  const { info } = await startGuestSession();
  const blobKey = `${info.workspaceId}/${sha}.pdf`;
  await getBlobStore().put(blobKey, pdfBytes, "application/pdf");
  const doc = await documentsRepo.create({
    workspaceId: info.workspaceId,
    originalFilename: "test.pdf",
    mime: "application/pdf",
    byteSize: pdfBytes.length,
    sha256: sha,
    blobKey,
  });
  const job = await jobsRepo.enqueue({ workspaceId: info.workspaceId, documentId: doc.id, kind: "process_document" });
  setModelProviderForTests(new MockModelProvider(async () => ({ ...gt, docType: kind })));
  return { info, doc, job };
}

afterEach(() => setModelProviderForTests(null));

describe("mock pipeline", () => {
  it("extracts, finalises, and is idempotent on re-run", async () => {
    const { info, doc, job } = await seed("invoice");
    await runJob(job);
    expect((await documentsRepo.getByIdUnscoped(doc.id))?.status).toBe("needs_review");
    const stored = await invoicesRepo.getByDocument(info.workspaceId, doc.id);
    expect(stored?.invoice.total).toBe("1764.48");
    expect(stored?.invoice.vendorKey).toBe("halcyon cloud services");
    expect(stored?.lineItems).toHaveLength(3);
    expect(stored?.lineItems[1].quantity).toBe("4.0000");
    expect(stored?.invoice.fields.total.groundingMethod).toBe("none");
    expect((await jobsRepo.getById(job.id))?.status).toBe("succeeded");

    const runsBefore = (await pipelineRunsRepo.listByDocument(doc.id)).length;
    await jobsRepo.requeue(job.id);
    await runJob((await jobsRepo.getById(job.id))!);
    expect((await pipelineRunsRepo.listByDocument(doc.id)).length).toBe(runsBefore);
    expect((await documentsRepo.getByIdUnscoped(doc.id))?.status).toBe("needs_review");
  });

  it("rejects documents the model classifies as not an invoice", async () => {
    const { doc, job } = await seed("other");
    await runJob(job);
    const after = await documentsRepo.getByIdUnscoped(doc.id);
    expect(after?.status).toBe("rejected");
    expect(after?.failureCode).toBe("not_an_invoice");
    const stages = (await pipelineRunsRepo.listByDocument(doc.id)).map((r) => r.stage);
    expect(stages).toEqual(["extract"]);
  });

  it("retries a failing stage and marks the document failed when attempts run out", async () => {
    const { doc, job } = await seed("invoice");
    setModelProviderForTests({
      name: "boom",
      extract: async () => {
        throw new Error("model exploded");
      },
    });
    for (let i = 0; i < 3; i++) {
      await getDb().execute(sql`update jobs set run_after = now() - interval '1 second' where id = ${job.id}`);
      const { claimJobs } = await import("@/lib/queue/claim");
      const [claimed] = await claimJobs({ runnerId: "t", limit: 1, perWorkspace: 5, global: 5 });
      await runJob(claimed);
    }
    expect((await jobsRepo.getById(job.id))?.status).toBe("dead");
    const after = await documentsRepo.getByIdUnscoped(doc.id);
    expect(after?.status).toBe("failed");
    expect(after?.failureMessage).toBe("Processing failed. Try again.");
  });
});
