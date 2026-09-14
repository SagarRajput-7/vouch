import { json, handle } from "@/lib/api/respond";
import { assertSameOrigin } from "@/lib/api/same-origin";
import { requireSessionFor } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { auditRepo } from "@/lib/repo/audit";
import { documentsRepo } from "@/lib/repo/documents";
import { workspacesRepo } from "@/lib/repo/workspaces";

export const DELETE = handle(async (request) => {
  assertSameOrigin(request);
  const session = await requireSessionFor(request);
  const docs = await documentsRepo.listByWorkspace(session.workspaceId);
  const blobs = getBlobStore();
  for (const d of docs) await blobs.delete(d.blobKey);
  await auditRepo.log({ workspaceId: session.workspaceId, actorSessionId: session.sessionId, action: "workspace.deleted", targetType: "workspace", targetId: session.workspaceId, meta: { documents: docs.length } });
  await workspacesRepo.deleteCascade(session.workspaceId);
  return json({ ok: true });
});
