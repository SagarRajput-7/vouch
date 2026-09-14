import { bigint, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { workspaces } from "./workspaces";

export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_created_idx").on(t.createdAt)],
);
