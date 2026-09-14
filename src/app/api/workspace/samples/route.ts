import { readFile } from "node:fs/promises";
import path from "node:path";
import { json, handle } from "@/lib/api/respond";
import { assertSameOrigin } from "@/lib/api/same-origin";
import { requireSessionFor } from "@/lib/auth/session";
import { manifestSchema } from "@/lib/pipeline/extract/ground-truth";
import { ingestFile, type IngestOutcome } from "@/lib/pipeline/ingest";
import { scheduleDrain } from "@/lib/queue/drain";

export const maxDuration = 300;

const SAMPLES = path.join(process.cwd(), "samples");

export const POST = handle(async (request) => {
  assertSameOrigin(request);
  const session = await requireSessionFor(request);
  const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(SAMPLES, "manifest.json"), "utf8")));
  const results: IngestOutcome[] = [];
  for (const entry of manifest) {
    const bytes = new Uint8Array(await readFile(path.join(SAMPLES, "out", entry.file)));
    results.push(await ingestFile({ workspaceId: session.workspaceId, actorSessionId: session.sessionId, filename: entry.file, bytes }));
  }
  if (results.some((r) => r.kind === "accepted")) scheduleDrain("samples");
  return json({ results: results.map((r) => (r.kind === "accepted" ? { kind: r.kind, filename: r.filename, documentId: r.document.id } : r)) });
});
