import { z } from "zod";

export const jobExtractionSchema = z.object({
  job_type: z.string(),
  scope_items: z.array(z.string()).default([]),
  dimensions: z.string().optional(),
  materials_mentioned: z.array(z.string()).default([]),
  access_issues: z.string().optional(),
  timeline: z.string().optional(),
  notes: z.string().optional(),
});

export type JobExtraction = z.infer<typeof jobExtractionSchema>;

export const lineItemSchema = z.object({
  description: z.string(),
  category: z.enum(["labour", "materials", "travel", "callout", "other"]),
  quantity: z.number().positive(),
  unit: z.string(),
  unit_price: z.number().nonnegative(),
  assumed: z.boolean().default(false),
  assumption_note: z.string().optional(),
});

export type LineItem = z.infer<typeof lineItemSchema>;

export const quoteDraftSchema = z.object({
  line_items: z.array(lineItemSchema).min(1),
});

export type QuoteDraft = z.infer<typeof quoteDraftSchema>;
