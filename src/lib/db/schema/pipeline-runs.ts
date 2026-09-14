import { index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import { jobs } from "./jobs";

export const runStatus = pgEnum("run_status", ["running", "succeeded", "failed", "skipped"]);

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
    stage: text("stage").notNull(),
    status: runStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    error: text("error"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("pipeline_runs_document_idx").on(t.documentId, t.startedAt)],
);
