import { z } from "zod";

// Valid enum values matching the database constraints
const vatTreatmentValues = ["standard", "zero", "exempt", "reverse_charge", "unknown"] as const;
const categoryValues = ["materials", "labour", "subcontractor", "plant_hire", "other"] as const;
const sourceValues = ["voice", "photo", "manual"] as const;
const counterpartyKindValues = ["supplier", "subcontractor", "other"] as const;

export const createJobCostSchema = z.object({
  jobId: z.string().uuid("Invalid job ID"),
  description: z.string().trim().min(1, "Description is required"),
  amountNet: z.number().int("Amount must be in pence (integer)"),
  vatAmount: z.number().int("VAT amount must be in pence (integer)").nullable().optional(),
  vatTreatment: z.enum(vatTreatmentValues).optional().default("unknown"),
  category: z.enum(categoryValues),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  paid: z.boolean().optional().default(false),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").nullable().optional(),
  evidenceUrl: z.string().url().nullable().optional(),
  source: z.enum(sourceValues),
  counterpartyName: z.string().trim().min(1).nullable().optional(),
  counterpartyKind: z.enum(counterpartyKindValues).optional(),
});

export const updateJobCostSchema = z.object({
  costId: z.string().uuid("Invalid cost ID"),
  description: z.string().trim().min(1, "Description is required").optional(),
  amountNet: z.number().int("Amount must be in pence (integer)").optional(),
  vatAmount: z.number().int("VAT amount must be in pence (integer)").nullable().optional(),
  vatTreatment: z.enum(vatTreatmentValues).optional(),
  category: z.enum(categoryValues).optional(),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional(),
  paid: z.boolean().optional(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").nullable().optional(),
  evidenceUrl: z.string().url().nullable().optional(),
});

export const markCostPaidSchema = z.object({
  costId: z.string().uuid("Invalid cost ID"),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
});

export type CreateJobCostInput = z.infer<typeof createJobCostSchema>;
export type UpdateJobCostInput = z.infer<typeof updateJobCostSchema>;
export type MarkCostPaidInput = z.infer<typeof markCostPaidSchema>;
