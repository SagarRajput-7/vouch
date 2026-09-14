import { z } from "zod";
import { docTypeValues, fieldNames } from "./schema";

const gtScalar = z
  .object({
    value: z.string().nullable(),
    display: z.string().nullable().optional(),
    page: z.number().int().positive().optional(),
  })
  .nullable();

export const groundTruthSchema = z.object({
  name: z.string(),
  docType: z.enum(docTypeValues),
  fields: z.object(Object.fromEntries(fieldNames.map((f) => [f, gtScalar])) as Record<(typeof fieldNames)[number], typeof gtScalar>),
  lineItems: z.array(
    z.object({
      description: z.string(),
      quantity: z.string(),
      unitPrice: z.string(),
      amount: z.string(),
      display: z.object({ quantity: z.string().optional(), unitPrice: z.string().optional(), amount: z.string().optional() }).optional(),
      page: z.number().int().positive().optional(),
    }),
  ),
  expectedIssues: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export type GroundTruth = z.infer<typeof groundTruthSchema>;

export const manifestSchema = z.array(
  z.object({
    name: z.string(),
    file: z.string(),
    mime: z.enum(["application/pdf", "image/png", "image/jpeg"]),
    sha256: z.string().length(64),
    pages: z.number().int().positive(),
    kind: z.enum(["pdf_text", "pdf_scan", "image"]),
  }),
);
export type Manifest = z.infer<typeof manifestSchema>;
