import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { documents, invoices, lineItems, type InvoiceFields, type LineItemMeta } from "@/lib/db/schema";

export type Invoice = typeof invoices.$inferSelect;
export type LineItem = typeof lineItems.$inferSelect;

export type UpsertInvoiceInput = {
  documentId: string;
  workspaceId: string;
  docType: Invoice["docType"];
  header: Pick<Invoice, "vendorName" | "vendorKey" | "invoiceNumber" | "issueDate" | "dueDate" | "currency" | "subtotal" | "tax" | "shipping" | "discount" | "total">;
  fields: InvoiceFields;
  lineItems: Array<{ idx: number; description: string | null; quantity: string | null; unitPrice: string | null; amount: string | null; meta: LineItemMeta }>;
};

export const invoicesRepo = {
  async upsertFromExtraction(input: UpsertInvoiceInput): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .insert(invoices)
        .values({
          documentId: input.documentId,
          workspaceId: input.workspaceId,
          docType: input.docType,
          ...input.header,
          fields: input.fields,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: invoices.documentId,
          set: { docType: input.docType, ...input.header, fields: input.fields, updatedAt: new Date() },
        });
      await tx.delete(lineItems).where(eq(lineItems.documentId, input.documentId));
      if (input.lineItems.length > 0) {
        await tx.insert(lineItems).values(input.lineItems.map((li) => ({ ...li, documentId: input.documentId })));
      }
    });
  },

  async getByDocument(workspaceId: string, documentId: string): Promise<{ invoice: Invoice; lineItems: LineItem[] } | null> {
    const db = getDb();
    const invoice = await db.query.invoices.findFirst({
      where: and(eq(invoices.workspaceId, workspaceId), eq(invoices.documentId, documentId)),
    });
    if (!invoice) return null;
    const items = await db.query.lineItems.findMany({ where: eq(lineItems.documentId, documentId), orderBy: (t, { asc }) => [asc(t.idx)] });
    return { invoice, lineItems: items };
  },

  /** Another document in the workspace with the same vendor key and invoice number. */
  async findDuplicate(workspaceId: string, vendorKey: string, invoiceNumber: string, excludeDocumentId: string): Promise<{ documentId: string; filename: string } | null> {
    const rows = await getDb()
      .select({ documentId: invoices.documentId, filename: documents.originalFilename })
      .from(invoices)
      .innerJoin(documents, eq(documents.id, invoices.documentId))
      .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.vendorKey, vendorKey), eq(invoices.invoiceNumber, invoiceNumber), ne(invoices.documentId, excludeDocumentId)))
      .limit(1);
    return rows[0] ?? null;
  },
};
