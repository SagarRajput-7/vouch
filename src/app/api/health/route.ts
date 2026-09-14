import { sql } from "drizzle-orm";
import { json } from "@/lib/api/respond";
import { getBlobStore } from "@/lib/blob";
import { dbFlavour, ensureDbReady, getDb } from "@/lib/db/client";
import { llmMode } from "@/lib/env";

export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  try {
    await ensureDbReady();
    await getDb().execute(sql`select 1`);
    checks.database = "ok";
  } catch {
    checks.database = "fail";
  }
  checks.blob = (await getBlobStore().probe()) ? "ok" : "fail";
  const ok = Object.values(checks).every((v) => v === "ok");
  return json(
    { ok, checks, database: dbFlavour(), llmMode, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local" },
    ok ? 200 : 503,
  );
}
