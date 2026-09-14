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
};
