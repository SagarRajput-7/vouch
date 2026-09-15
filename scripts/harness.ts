import { readFile } from "node:fs/promises";
import path from "node:path";
import { startGuestSession } from "../src/lib/auth/session";
import { ensureDbReady } from "../src/lib/db/client";
import { manifestSchema, type Manifest } from "../src/lib/pipeline/extract/ground-truth";
import { ingestFile } from "../src/lib/pipeline/ingest";
import { runJob } from "../src/lib/pipeline/runner";
import { claimJobs } from "../src/lib/queue/claim";

export type Processed = { entry: Manifest[number]; documentId: string; workspaceId: string };

const SAMPLES_ROOT = path.resolve("samples");

export async function readManifest(): Promise<Manifest> {
  return manifestSchema.parse(JSON.parse(await readFile(path.join(SAMPLES_ROOT, "manifest.json"), "utf8")));
}

/**
 * Ingests every sample into one fresh workspace and runs the queue to completion. The scripts set
 * VOUCH_DISABLE_AUTO_DRAIN so this claim loop is the only runner in the process: a background drain
 * would race it for the same jobs and interleave its log lines with the report.
 */
export async function processSamples(filter?: (entry: Manifest[number]) => boolean): Promise<Processed[]> {
  await ensureDbReady();
  const { info } = await startGuestSession();
  const manifest = await readManifest();
  const processed: Processed[] = [];
  for (const entry of manifest) {
    if (filter && !filter(entry)) continue;
    const bytes = new Uint8Array(await readFile(path.join(SAMPLES_ROOT, "out", entry.file)));
    const outcome = await ingestFile({ workspaceId: info.workspaceId, actorSessionId: "script", filename: entry.file, bytes });
    if (outcome.kind !== "accepted") throw new Error(`${entry.name}: ${outcome.kind}`);
    processed.push({ entry, documentId: outcome.document.id, workspaceId: info.workspaceId });
  }
  for (;;) {
    const [job] = await claimJobs({ runnerId: "script", limit: 1, perWorkspace: 10, global: 10 });
    if (!job) break;
    process.stdout.write(`processing ${processed.find((p) => p.documentId === job.documentId)?.entry.name ?? job.id}\n`);
    await runJob(job);
  }
  return processed;
}
