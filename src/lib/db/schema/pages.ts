import { index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { documents } from "./documents";

export const textSource = pgEnum("text_source", ["pdf", "ocr", "none"]);

export type PositionedToken = { text: string; x: number; y: number; w: number; h: number; line: number };

export const pages = pgTable(
  "pages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    pageNo: integer("page_no").notNull(),
    width: real("width").notNull(),
    height: real("height").notNull(),
    rotation: integer("rotation").notNull().default(0),
    textSource: textSource("text_source").notNull().default("none"),
    ocrMeanConfidence: real("ocr_mean_confidence"),
    tokens: jsonb("tokens").$type<PositionedToken[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pages_document_page_idx").on(t.documentId, t.pageNo), index("pages_document_idx").on(t.documentId)],
);
