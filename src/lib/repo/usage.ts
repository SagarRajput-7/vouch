import { and, gte, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { usageLedger } from "@/lib/db/schema";

export const usageRepo = {
  async record(input: {
    workspaceId: string;
    documentId: string | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costMicros: number;
  }): Promise<void> {
    await getDb().insert(usageLedger).values(input);
  },

  async dailyTotalMicros(now: Date = new Date()): Promise<number> {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + 86_400_000);
    const [row] = await getDb()
      .select({ total: sql<string>`coalesce(sum(${usageLedger.costMicros}), 0)` })
      .from(usageLedger)
      .where(and(gte(usageLedger.createdAt, start), lt(usageLedger.createdAt, end)));
    return Number(row?.total ?? 0);
  },
};
