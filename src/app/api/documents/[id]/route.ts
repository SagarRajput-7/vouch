import { json, handle } from "@/lib/api/respond";
import { assertSameOrigin } from "@/lib/api/same-origin";
import { notFound } from "@/lib/api/errors";
import { requireSessionFor } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { summarise, toClientInvoice, type DocumentDetail } from "@/lib/api/documents";
import { auditRepo } from "@/lib/repo/audit";
import { documentsRepo } from "@/lib/repo/documents";
import { invoicesRepo } from "@/lib/repo/invoices";
import { issuesRepo } from "@/lib/repo/issues";
import { pagesRepo } from "@/lib/repo/pages";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";
import { usageRepo } from "@/lib/repo/usage";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (request, { params }: Ctx) => {
  const session = await requireSessionFor(request);
  const { id } = await params;
  const doc = await documentsRepo.getById(session.workspaceId, id);
  if (!doc) throw notFound("Document");
  const [stored, trace, issues, pages, usage] = await Promise.all([
    invoicesRepo.getByDocument(session.workspaceId, id),
    pipelineRunsRepo.listByDocument(id),
    issuesRepo.listByDocument(id),
    pagesRepo.listSummaries(id),
    usageRepo.totalsForDocument(id),
  ]);
  const body: DocumentDetail = {
    document: await summarise(doc),
    invoice: stored ? toClientInvoice(stored.invoice) : null,
    lineItems: stored?.lineItems ?? [],
    issues: issues.map((i) => ({ id: i.id, code: i.code, severity: i.severity, fieldPaths: i.fieldPaths, message: i.message, suggestion: i.suggestion, status: i.status, overrideReason: i.overrideReason, createdAt: i.createdAt.toISOString(), resolvedAt: i.resolvedAt?.toISOString() ?? null })),
    pages,
    usage,
    trace: trace.map((r) => ({ stage: r.stage, status: r.status, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, durationMs: r.durationMs, error: r.error, meta: r.meta })),
  };
  return json(body);
});

export const DELETE = handle<Ctx>(async (request, { params }: Ctx) => {
  assertSameOrigin(request);
  const session = await requireSessionFor(request);
  const { id } = await params;
  const doc = await documentsRepo.getById(session.workspaceId, id);
  if (!doc) throw notFound("Document");
  await getBlobStore().delete(doc.blobKey);
  await documentsRepo.delete(session.workspaceId, id);
  await auditRepo.log({ workspaceId: session.workspaceId, actorSessionId: session.sessionId, action: "document.deleted", targetType: "document", targetId: id });
  return json({ ok: true });
});
