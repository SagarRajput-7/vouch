import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const corrections = pgTable(
  "corrections",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    fieldPath: text("field_path").notNull(),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>(),
    actorSessionId: text("actor_session_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("corrections_document_idx").on(t.documentId, t.createdAt)],
);
