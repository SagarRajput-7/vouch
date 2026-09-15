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
  return recordingSchema.parse(JSON.parse(raw));
}

export async function writeRecording(rec: Recording, dir: string = RECORDINGS_DIR): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(recordingFile(rec.sha256, rec.kind, dir), JSON.stringify(rec, null, 2) + "\n");
}
