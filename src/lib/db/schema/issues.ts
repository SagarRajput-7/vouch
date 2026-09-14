import { index, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const issueSeverity = pgEnum("issue_severity", ["blocking", "warning", "info"]);
export const issueStatus = pgEnum("issue_status", ["open", "resolved", "overridden"]);

export const issues = pgTable(
  "issues",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    severity: issueSeverity("severity").notNull(),
    fieldPaths: text("field_paths").array().notNull().default([]),
    message: text("message").notNull(),
    suggestion: jsonb("suggestion").$type<unknown>(),
    status: issueStatus("status").notNull().default("open"),
    overrideReason: text("override_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("issues_document_status_idx").on(t.documentId, t.status)],
);
