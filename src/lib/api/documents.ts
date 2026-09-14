import { documentsRepo, type Document } from "@/lib/repo/documents";
import { jobsRepo } from "@/lib/repo/jobs";

export type DocumentSummary = {
  id: string;
  filename: string;
  status: Document["status"];
  kind: Document["kind"];
  docType: Document["docType"];
  pageCount: number | null;
  byteSize: number;
  createdAt: string;
  failureCode: string | null;
  failureMessage: string | null;
  attempts: number | null;
};

/** JSON shape of a document for lists and detail. Lives outside the route module because Next only allows handler exports there. */
export async function summarise(doc: Document): Promise<DocumentSummary> {
  const job = await jobsRepo.latestForDocument(doc.id);
  return {
    id: doc.id,
    filename: doc.originalFilename,
    status: doc.status,
    kind: doc.kind,
    docType: doc.docType,
    pageCount: doc.pageCount,
    byteSize: doc.byteSize,
    createdAt: doc.createdAt.toISOString(),
    failureCode: doc.failureCode,
    failureMessage: doc.failureMessage,
    attempts: job?.attempts ?? null,
  };
}

export async function listSummaries(workspaceId: string): Promise<DocumentSummary[]> {
  const docs = await documentsRepo.listByWorkspace(workspaceId);
  return Promise.all(docs.map(summarise));
}
