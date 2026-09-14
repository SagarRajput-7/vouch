import { json, handle } from "@/lib/api/respond";
import { assertSameOrigin } from "@/lib/api/same-origin";
import { ApiError } from "@/lib/api/errors";
import { listSummaries, summarise, type DocumentSummary } from "@/lib/api/documents";
import { requireSessionFor } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { ingestFile, LIMITS, type IngestOutcome } from "@/lib/pipeline/ingest";
import { scheduleDrain } from "@/lib/queue/drain";

export const maxDuration = 300;

export const GET = handle(async (request) => {
  const session = await requireSessionFor(request);
  return json({ documents: await listSummaries(session.workspaceId) });
});

export const POST = handle(async (request) => {
  assertSameOrigin(request);
  const session = await requireSessionFor(request);
  if (!env.UPLOADS_ENABLED) throw new ApiError(503, "uploads_disabled", "Uploads are paused right now. Try again later.");

  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new ApiError(400, "no_files", "Choose at least one file.");
  if (files.length > LIMITS.maxFilesPerRequest) throw new ApiError(400, "too_many_files", "Upload at most 5 files at a time.");

  const results: Array<IngestOutcome | { kind: "accepted"; filename: string; document: DocumentSummary }> = [];
  for (const file of files) {
    const outcome = await ingestFile({
      workspaceId: session.workspaceId,
      actorSessionId: session.sessionId,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    results.push(outcome.kind === "accepted" ? { kind: "accepted", filename: outcome.filename, document: await summarise(outcome.document) } : outcome);
  }
  if (results.some((r) => r.kind === "accepted")) scheduleDrain("upload");
  return json({ results });
});
