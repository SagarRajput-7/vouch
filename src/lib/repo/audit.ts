import { getDb } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

export type AuditEntry = {
  workspaceId: string;
  actorSessionId: string;
  action: string;
  targetType: string;
  targetId?: string;
  meta?: Record<string, unknown>;
};

export const auditRepo = {
  async log(entry: AuditEntry): Promise<void> {
    await getDb().insert(auditLog).values({ ...entry, meta: entry.meta ?? {} });
  },
};
