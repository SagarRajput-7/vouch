import { index, integer, jsonb, numeric, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { documents } from "./documents";
import type { FieldMeta } from "./invoices";

export type LineItemMeta = Partial<Record<"description" | "quantity" | "unitPrice" | "amount", FieldMeta>>;

export const lineItems = pgTable(
  "line_items",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    description: text("description"),
    quantity: numeric("quantity", { precision: 18, scale: 4 }),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }),
    amount: numeric("amount", { precision: 18, scale: 2 }),
    meta: jsonb("meta").$type<LineItemMeta>().notNull().default({}),
  },
  (t) => [uniqueIndex("line_items_document_idx_idx").on(t.documentId, t.idx), index("line_items_document_idx").on(t.documentId)],
);
