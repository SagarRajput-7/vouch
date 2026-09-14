import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";

export const documentStatus = pgEnum("document_status", [
  "queued",
  "processing",
  "needs_review",
  "verified",
  "failed",
  "rejected",
]);
export const documentKind = pgEnum("document_kind", ["unknown", "pdf_text", "pdf_scan", "image"]);
export const docType = pgEnum("doc_type", ["invoice", "receipt", "credit_note", "other"]);

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    originalFilename: text("original_filename").notNull(),
    mime: text("mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    blobKey: text("blob_key").notNull(),
    pageCount: integer("page_count"),
    kind: documentKind("kind").notNull().default("unknown"),
    status: documentStatus("status").notNull().default("queued"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    docType: docType("doc_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("documents_workspace_sha_idx").on(t.workspaceId, t.sha256),
    index("documents_workspace_status_idx").on(t.workspaceId, t.status, t.createdAt),
  ],
);
