import { index, integer, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { workspaces } from "./workspaces";

export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "dead"]);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: text("document_id").references(() => documents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_status_run_after_idx").on(t.status, t.runAfter), index("jobs_document_idx").on(t.documentId)],
);
