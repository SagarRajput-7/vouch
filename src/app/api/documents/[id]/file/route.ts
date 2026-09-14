import { handle } from "@/lib/api/respond";
import { notFound } from "@/lib/api/errors";
import { requireSessionFor } from "@/lib/auth/session";
import { getBlobStore } from "@/lib/blob";
import { documentsRepo } from "@/lib/repo/documents";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (request, { params }: Ctx) => {
  const session = await requireSessionFor(request);
  const { id } = await params;
  const doc = await documentsRepo.getById(session.workspaceId, id);
  if (!doc) throw notFound("Document");
  const blob = await getBlobStore().get(doc.blobKey);
  if (!blob) throw notFound("File");
  const safeName = doc.originalFilename.replace(/["\r\n]/g, "");
  // The blob store types bytes as Uint8Array<ArrayBufferLike> (to also allow SharedArrayBuffer),
  // but lib.dom's BodyInit wants Uint8Array<ArrayBuffer>. Re-wrapping (not casting) produces a
  // concretely-typed, ArrayBuffer-backed copy via the `ArrayLike<number>` constructor overload.
  return new Response(new Uint8Array(blob.bytes), {
    headers: {
      "content-type": blob.contentType,
      "content-length": String(blob.bytes.byteLength),
      "content-disposition": `inline; filename="${safeName}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
