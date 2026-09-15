import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { extractionResultSchema } from "./schema";

export const recordingSchema = z.object({
  sha256: z.string(),
  kind: z.enum(["initial", "reconcile"]),
  model: z.string(),
  promptVersion: z.string(),
  recordedAt: z.string(),
  result: extractionResultSchema,
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheWriteTokens: z.number(),
    cacheReadTokens: z.number(),
    latencyMs: z.number(),
    costMicros: z.number(),
  }),
});
export type Recording = z.infer<typeof recordingSchema>;

export const RECORDINGS_DIR = path.join(process.cwd(), "samples", "recordings");

export function recordingFile(sha256: string, kind: Recording["kind"], dir: string = RECORDINGS_DIR): string {
  return path.join(dir, `${sha256}.${kind}.json`);
}

export async function readRecording(sha256: string, kind: Recording["kind"], dir: string = RECORDINGS_DIR): Promise<Recording | null> {
  let raw: string;
  try {
    raw = await readFile(recordingFile(sha256, kind, dir), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const rec = recordingSchema.parse(JSON.parse(raw));
  // The filename is the only thing that ties a recording to a document. A file whose contents
  // disagree with its name would replay one document's answer for another, so it is an error,
  // not a miss to fall through on.
  if (rec.sha256 !== sha256 || rec.kind !== kind) {
    throw new Error(`Recording ${recordingFile(sha256, kind, dir)} holds ${rec.sha256}.${rec.kind}; refusing to replay it.`);
  }
  return rec;
}

export async function writeRecording(rec: Recording, dir: string = RECORDINGS_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(recordingFile(rec.sha256, rec.kind, dir), JSON.stringify(rec, null, 2) + "\n");
}
