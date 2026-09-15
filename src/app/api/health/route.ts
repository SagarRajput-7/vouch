import { sql } from "drizzle-orm";
import { json } from "@/lib/api/respond";
import { getBlobStore } from "@/lib/blob";
import { dbFlavour, ensureDbReady, getDb } from "@/lib/db/client";
import { env, llmMode } from "@/lib/env";
import { usageRepo } from "@/lib/repo/usage";

export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  // Today's model spend against the cap, so an operator can tell a paused queue from a stuck one
  // without opening the database. Null when the database is unreachable and nothing can be read.
  let budget: { spentTodayMicros: number; capUsd: number } | null = null;
  try {
    await ensureDbReady();
    await getDb().execute(sql`select 1`);
    checks.database = "ok";
    budget = { spentTodayMicros: await usageRepo.dailyTotalMicros(), capUsd: env.BUDGET_DAILY_USD };
  } catch {
    checks.database = "fail";
  }
  checks.blob = (await getBlobStore().probe()) ? "ok" : "fail";
  const ok = Object.values(checks).every((v) => v === "ok");
  return json(
    { ok, checks, database: dbFlavour(), llmMode, budget, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local" },
    ok ? 200 : 503,
  );
}
