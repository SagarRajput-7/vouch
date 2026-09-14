import { json, handle } from "@/lib/api/respond";
import { assertSameOrigin } from "@/lib/api/same-origin";
import { ApiError, notFound } from "@/lib/api/errors";
import { requireSessionFor } from "@/lib/auth/session";
import { scheduleDrain } from "@/lib/queue/drain";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo } from "@/lib/repo/jobs";
import { pipelineRunsRepo } from "@/lib/repo/pipeline-runs";

export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (request, { params }: Ctx) => {
  assertSameOrigin(request);
  const session = await requireSessionFor(request);
  const { id } = await params;
  const doc = await documentsRepo.getById(session.workspaceId, id);
  if (!doc) throw notFound("Document");
  if (doc.status !== "failed" && doc.status !== "rejected") {
    throw new ApiError(409, "not_retryable", "Only failed or rejected documents can be retried.");
  }
  // A manual retry means the person disagrees with the earlier outcome, so nothing from it
  // should be trusted: clear every stage checkpoint before requeueing so the job reprocesses
  // from extract instead of skipping straight to finalise on a stale extraction.
  await pipelineRunsRepo.deleteByDocument(id);
  const job = await jobsRepo.latestForDocument(id);
  if (job) await jobsRepo.requeue(job.id);
  else await jobsRepo.enqueue({ workspaceId: session.workspaceId, documentId: id, kind: "process_document" });
  await documentsRepo.setStatus(id, "queued");
  scheduleDrain("retry");
  return json({ ok: true });
});
