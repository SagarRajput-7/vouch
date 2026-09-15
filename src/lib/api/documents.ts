import { documentsRepo, type Document } from "@/lib/repo/documents";
import { jobsRepo } from "@/lib/repo/jobs";
import type { Invoice, LineItem } from "@/lib/repo/invoices";
import type { Issue } from "@/lib/repo/issues";
import type { ParsedPage } from "@/lib/pipeline/types";

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

/**
 * Invoice row shaped for the client: no Postgres-only `search` tsvector column, and its own
 * `verifiedAt`/`createdAt`/`updatedAt` timestamps as ISO strings (or null), matching every other
 * date in this payload rather than the `Date` objects the row decodes to at read time.
 */
export type ClientInvoice = Omit<Invoice, "search" | "createdAt" | "updatedAt" | "verifiedAt"> & {
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
};

export function toClientInvoice(invoice: Invoice): ClientInvoice {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest destructure drops `search` on purpose
  const { search: _search, createdAt, updatedAt, verifiedAt, ...rest } = invoice;
  return { ...rest, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(), verifiedAt: verifiedAt?.toISOString() ?? null };
}

/** JSON shape of `GET /api/documents/:id`, for the review screen. Dates are ISO strings. */
export type DocumentDetail = {
  document: DocumentSummary;
  invoice: ClientInvoice | null;
  lineItems: LineItem[];
  issues: Array<Pick<Issue, "id" | "code" | "severity" | "fieldPaths" | "message" | "suggestion" | "status" | "overrideReason"> & { createdAt: string; resolvedAt: string | null }>;
  pages: Array<Omit<ParsedPage, "tokens">>;
  usage: { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; costMicros: number };
  trace: Array<{ stage: string; status: string; startedAt: string; finishedAt: string | null; durationMs: number | null; error: string | null; meta: Record<string, unknown> }>;
};
