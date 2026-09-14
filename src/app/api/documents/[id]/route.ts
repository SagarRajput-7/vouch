import { json, handle } from "@/lib/api/respond";
import { assertSameOrigin } from "@/lib/api/same-origin";
import { notFound } from "@/lib/api/errors";
import { requireSessionFor } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { summarise } from "@/lib/api/documents";
import { auditRepo } from "@/lib/repo/audit";
import { documentsRepo } from "@/lib/repo/documents";
import { invoicesRepo } from "@/lib/repo/invoices";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (request, { params }: Ctx) => {
  const session = await requireSessionFor(request);
  const { id } = await params;
  const doc = await documentsRepo.getById(session.workspaceId, id);
  if (!doc) throw notFound("Document");
  const stored = await invoicesRepo.getByDocument(session.workspaceId, id);
  const trace = await pipelineRunsRepo.listByDocument(id);
  return json({
    document: await summarise(doc),
    invoice: stored?.invoice ?? null,
    lineItems: stored?.lineItems ?? [],
    issues: [],
    trace: trace.map((r) => ({ stage: r.stage, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, durationMs: r.durationMs, error: r.error, meta: r.meta })),
  });
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
