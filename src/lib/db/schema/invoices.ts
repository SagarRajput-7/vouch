import { customType, date, index, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { documents, docType } from "./documents";
import { workspaces } from "./workspaces";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export type GroundingMethod = "exact" | "normalized" | "fuzzy" | "none";
export type FieldStatus = "pending" | "accepted" | "corrected";
export type FieldMeta = {
  value: string | null;
  sourceText: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  groundingScore: number;
  groundingMethod: GroundingMethod;
  modelConfidence: number;
  risk: number;
  status: FieldStatus;
  correctedAt: string | null;
};
export type InvoiceFields = Record<string, FieldMeta>;

export const invoices = pgTable(
  "invoices",
  {
    documentId: text("document_id").primaryKey().references(() => documents.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    vendorName: text("vendor_name"),
    vendorKey: text("vendor_key"),
    invoiceNumber: text("invoice_number"),
    issueDate: date("issue_date"),
    dueDate: date("due_date"),
    currency: text("currency"),
    subtotal: numeric("subtotal", { precision: 18, scale: 2 }),
    tax: numeric("tax", { precision: 18, scale: 2 }),
    shipping: numeric("shipping", { precision: 18, scale: 2 }),
    discount: numeric("discount", { precision: 18, scale: 2 }),
    total: numeric("total", { precision: 18, scale: 2 }),
    docType: docType("doc_type").notNull().default("invoice"),
    fields: jsonb("fields").$type<InvoiceFields>().notNull().default({}),
    search: tsvector("search"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBySessionId: text("verified_by_session_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invoices_workspace_vendor_idx").on(t.workspaceId, t.vendorKey),
    index("invoices_workspace_issue_date_idx").on(t.workspaceId, t.issueDate),
    index("invoices_workspace_total_idx").on(t.workspaceId, t.total),
    index("invoices_search_idx").using("gin", t.search),
  ],
);
