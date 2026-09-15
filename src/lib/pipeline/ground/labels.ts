import type { FieldName } from "@/lib/pipeline/extract/schema";

/** Words that usually sit next to each field. Used only to break ties between equal values. */
export const LABELS: Record<FieldName, string[]> = {
  vendorName: [],
  invoiceNumber: ["invoice number", "invoice no", "invoice #", "invoice", "no.", "number", "rechnungsnummer", "rechnung nr", "inv"],
  issueDate: ["invoice date", "date", "issued", "dated", "rechnungsdatum", "datum"],
  dueDate: ["due date", "due", "payment due", "payable by", "fällig", "zahlbar bis"],
  currency: ["currency", "amounts in", "prices in"],
  subtotal: ["subtotal", "sub total", "sub-total", "net amount", "net total", "net", "nettobetrag"],
  tax: ["tax", "vat", "gst", "sales tax", "ust", "mwst", "igst", "cgst", "sgst", "hst"],
  shipping: ["shipping", "delivery", "freight", "postage", "carriage", "versand"],
  discount: ["discount", "less", "rabatt"],
  total: ["total", "total due", "amount due", "balance due", "grand total", "amount payable", "total payable", "gesamtbetrag", "payable"],
};
