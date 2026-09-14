import { json, handle } from "@/lib/api/respond";
import { requireSessionFor } from "@/lib/auth/session";
import { scheduleDrain } from "@/lib/queue/drain";
import { documentsRepo } from "@/lib/repo/documents";
import { jobsRepo } from "@/lib/repo/jobs";

export const maxDuration = 300;

export type WorkspaceStatus = {
  counts: Record<string, number>;
  inFlight: Array<{ id: string; filename: string; status: string }>;
  queuedJobs: number;
};

export const GET = handle(async (request) => {
  const session = await requireSessionFor(request);
  const docs = await documentsRepo.listByWorkspace(session.workspaceId);
  const counts: Record<string, number> = {};
  for (const d of docs) counts[d.status] = (counts[d.status] ?? 0) + 1;
  const inFlight = docs.filter((d) => d.status === "queued" || d.status === "processing").map((d) => ({ id: d.id, filename: d.originalFilename, status: d.status }));
  const queuedJobs = await jobsRepo.countQueued();
  if (queuedJobs > 0 || inFlight.length > 0) scheduleDrain("status-poll");
  const body: WorkspaceStatus = { counts, inFlight, queuedJobs };
  return json(body);
});
