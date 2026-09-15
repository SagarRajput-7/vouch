import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const extractionKind = pgEnum("extraction_kind", ["initial", "reconcile"]);

export const extractions = pgTable(
  "extractions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    kind: extractionKind("kind").notNull().default("initial"),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    raw: jsonb("raw").$type<unknown>().notNull(),
    /** False for a reconcile attempt that did not reduce blocking issues; such rows are kept for the trace but never used. */
    adopted: boolean("adopted").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("extractions_document_idx").on(t.documentId)],
);
