import { z } from "zod";

export const scalarSchema = z.object({
  value: z.string().nullable(),
  sourceText: z.string().nullable(),
  page: z.number().int().positive().nullable(),
  confidence: z.number().min(0).max(1),
});

export const docTypeValues = ["invoice", "receipt", "credit_note", "other"] as const;

export const fieldNames = [
  "vendorName",
  "invoiceNumber",
  "issueDate",
  "dueDate",
  "currency",
  "subtotal",
  "tax",
  "shipping",
  "discount",
  "total",
] as const;
export type FieldName = (typeof fieldNames)[number];

export const lineItemSchema = z.object({
  description: scalarSchema,
  quantity: scalarSchema,
  unitPrice: scalarSchema,
  amount: scalarSchema,
});

export const extractionResultSchema = z.object({
  docType: z.object({ value: z.enum(docTypeValues), confidence: z.number().min(0).max(1), reason: z.string() }),
  fields: z.object(Object.fromEntries(fieldNames.map((f) => [f, scalarSchema])) as Record<FieldName, typeof scalarSchema>),
  lineItems: z.array(lineItemSchema),
  notes: z.string().nullable(),
});

export type ExtractedScalar = z.infer<typeof scalarSchema>;
export type ExtractedLineItem = z.infer<typeof lineItemSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
