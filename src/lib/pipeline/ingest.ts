import { getBlobStore } from "@/lib/blob";
import { detectFileType, extensionFor } from "@/lib/files/detect-type";
import { sha256Hex } from "@/lib/files/hash";
import { sanitizeFilename } from "@/lib/files/sanitize";
import { auditRepo } from "@/lib/repo/audit";
import { documentsRepo, type Document } from "@/lib/repo/documents";
import { jobsRepo, type Job } from "@/lib/repo/jobs";

export const LIMITS = {
  maxFileBytes: 4 * 1024 * 1024,
  maxFilesPerRequest: 5,
  maxDocumentsPerWorkspace: 25,
} as const;

export type IngestOutcome =
  | { kind: "accepted"; filename: string; document: Document; job: Job }
  | { kind: "duplicate"; filename: string; existingId: string }
  | { kind: "rejected"; filename: string; code: "too_large" | "unsupported_type" | "workspace_full" | "empty"; message: string };

export async function ingestFile(input: {
  workspaceId: string;
  actorSessionId: string;
  filename: string;
  bytes: Uint8Array;
}): Promise<IngestOutcome> {
  const filename = sanitizeFilename(input.filename);
  if (input.bytes.length === 0) return { kind: "rejected", filename, code: "empty", message: "The file is empty." };
  if (input.bytes.length > LIMITS.maxFileBytes) {
    return { kind: "rejected", filename, code: "too_large", message: "Files must be 4 MB or smaller." };
  }
  const mime = detectFileType(input.bytes);
  if (!mime) {
    return { kind: "rejected", filename, code: "unsupported_type", message: "Only PDF, PNG and JPEG files are supported." };
  }
  const sha256 = sha256Hex(input.bytes);
  const existing = await documentsRepo.findBySha(input.workspaceId, sha256);
  if (existing) return { kind: "duplicate", filename, existingId: existing.id };

  const count = await documentsRepo.countByWorkspace(input.workspaceId);
  if (count >= LIMITS.maxDocumentsPerWorkspace) {
    return { kind: "rejected", filename, code: "workspace_full", message: "This workspace holds 25 documents. Delete some to add more." };
  }

  const blobKey = `${input.workspaceId}/${sha256}.${extensionFor(mime)}`;
  await getBlobStore().put(blobKey, input.bytes, mime);
  const document = await documentsRepo.create({
    workspaceId: input.workspaceId,
    originalFilename: filename,
    mime,
    byteSize: input.bytes.length,
    sha256,
    blobKey,
    kind: mime === "application/pdf" ? "unknown" : "image",
  });
  const job = await jobsRepo.enqueue({ workspaceId: input.workspaceId, documentId: document.id, kind: "process_document" });
  await auditRepo.log({
    workspaceId: input.workspaceId,
    actorSessionId: input.actorSessionId,
    action: "document.uploaded",
    targetType: "document",
    targetId: document.id,
    meta: { filename, mime, byteSize: input.bytes.length },
  });
  return { kind: "accepted", filename, document, job };
}
