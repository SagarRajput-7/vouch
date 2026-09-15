import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startGuestSession } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { sha256Hex } from "@/lib/files/hash";
import { setModelProviderForTests } from "@/lib/pipeline/extract/model";
import { runJob } from "@/lib/pipeline/runner";
import { extractStage } from "@/lib/pipeline/stages/extract";
import { groundStage } from "@/lib/pipeline/stages/ground";
import { parseStage } from "@/lib/pipeline/stages/parse";
import { validateStage } from "@/lib/pipeline/stages/validate";
import { documentsRepo } from "@/lib/repo/documents";
import { invoicesRepo } from "@/lib/repo/invoices";
import { issuesRepo } from "@/lib/repo/issues";
import { jobsRepo } from "@/lib/repo/jobs";

const STAGES = [parseStage, extractStage, groundStage, validateStage];

async function seed(workspaceId: string, name: string, filename = `${name}.pdf`) {
  const bytes = new Uint8Array(await readFile(path.resolve("samples/out", `${name}.pdf`)));
  const sha = sha256Hex(bytes);
  const blobKey = `${workspaceId}/${sha}.pdf`;
  await getBlobStore().put(blobKey, bytes, "application/pdf");
  const doc = await documentsRepo.create({ workspaceId, originalFilename: filename, mime: "application/pdf", byteSize: bytes.length, sha256: sha, blobKey });
  const job = await jobsRepo.enqueue({ workspaceId, documentId: doc.id, kind: "process_document" });
  return { doc, job };
}

afterEach(() => setModelProviderForTests(null));

describe("validate stage", () => {
  it("stores the arithmetic issue for the mismatch sample with its suggestion", async () => {
    const { info } = await startGuestSession();
    const { doc, job } = await seed(info.workspaceId, "mismatch-total");
    await runJob(job, STAGES);
    const issues = await issuesRepo.listByDocument(doc.id);
    expect(issues.map((i) => i.code)).toEqual(["V003"]);
    expect(issues[0]).toMatchObject({ severity: "blocking", status: "open", suggestion: { fieldPath: "total", value: "791.70" } });
    expect((await documentsRepo.getByIdUnscoped(doc.id))?.status).toBe("processing");
  });

  it("stores a mixed set with the blocking issue ahead of the warning", async () => {
    const { info } = await startGuestSession();
    const { doc, job } = await seed(info.workspaceId, "mismatch-total");
    const { MockModelProvider, manifestLookup } = await import("@/lib/pipeline/extract/mock-provider");
    setModelProviderForTests(
      new MockModelProvider(async (sha) => {
        const gt = await manifestLookup(sha);
        return gt ? { ...gt, fields: { ...gt.fields, dueDate: { value: "2026-07-01", display: "01/07/2026", page: 1 } } } : null;
      }),
    );
    await runJob(job, STAGES);
    const issues = await issuesRepo.listByDocument(doc.id);
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      ["V003", "blocking"],
      ["V005", "warning"],
    ]);
  });

  it("warns about a duplicate invoice already in the workspace", async () => {
    const { info } = await startGuestSession();
    const first = await seed(info.workspaceId, "clean-digital", "first.pdf");
    await invoicesRepo.upsertFromExtraction({
      documentId: first.doc.id,
      workspaceId: info.workspaceId,
      docType: "invoice",
      header: { vendorName: "Halcyon Cloud Services Inc.", vendorKey: "halcyon cloud services", invoiceNumber: "HCS-2026-0417", issueDate: null, dueDate: null, currency: "USD", subtotal: null, tax: null, shipping: null, discount: null, total: "1764.48" },
      fields: {},
      lineItems: [],
    });
    // Same bytes cannot be uploaded twice into one workspace, so the second document is the
    // mismatch sample with its extraction forced to the clean sample's vendor and number.
    const second = await seed(info.workspaceId, "mismatch-total", "second.pdf");
    const { MockModelProvider, manifestLookup } = await import("@/lib/pipeline/extract/mock-provider");
    setModelProviderForTests(
      new MockModelProvider(async (sha) => {
        const gt = await manifestLookup(sha);
        return gt ? { ...gt, fields: { ...gt.fields, vendorName: { value: "Halcyon Cloud Services Inc.", page: 1 }, invoiceNumber: { value: "HCS-2026-0417", page: 1 } } } : null;
      }),
    );
    await runJob(second.job, STAGES);
    const codes = (await issuesRepo.listByDocument(second.doc.id)).map((i) => i.code);
    expect(codes).toContain("V008");
    const dup = (await issuesRepo.listByDocument(second.doc.id)).find((i) => i.code === "V008")!;
    expect(dup.suggestion).toMatchObject({ kind: "duplicate", documentId: first.doc.id, filename: "first.pdf" });
  });

  it("records V011 when the model rejects the document", async () => {
    const { info } = await startGuestSession();
    const { doc, job } = await seed(info.workspaceId, "not-an-invoice");
    await runJob(job, STAGES);
    expect((await documentsRepo.getByIdUnscoped(doc.id))?.status).toBe("rejected");
    expect((await issuesRepo.listByDocument(doc.id)).map((i) => i.code)).toEqual(["V011"]);
  });
});
