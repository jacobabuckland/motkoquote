import { z } from "zod";

export const nullishString = z
  .string()
  .nullable()
  .transform((value) => value ?? undefined)
  .optional();

export const jobExtractionSchema = z.object({
  job_type: z.string(),
  scope_items: z.array(z.string()).default([]),
  dimensions: nullishString,
  materials_mentioned: z.array(z.string()).default([]),
  access_issues: nullishString,
  timeline: nullishString,
  notes: nullishString,
});

export type JobExtraction = z.infer<typeof jobExtractionSchema>;

export const lineItemSchema = z.object({
  description: z.string(),
  category: z.enum(["labour", "materials", "travel", "callout", "other"]),
  quantity: z.number().positive(),
  unit: z.string(),
  unit_price: z.number().nonnegative(),
  // Applied on top of quantity * unit_price — e.g. a 1.5x "difficult access"
  // or "unsociable hours" adjustment on a labour line. Defaults to 1 (no
  // adjustment) so existing line items and callers that never set this are
  // unaffected.
  multiplier: z.number().positive().default(1),
  // Team size for labour lines — quantity/unit still carry the day count
  // (e.g. quantity=2, unit="day"), this carries how many people worked those
  // days. Defaults to 1 so every non-labour or single-person line item is
  // unaffected. Code (applyLabourRates + lineItemTotal), not the LLM, is
  // responsible for reconciling this against the contractor's day rate.
  people_count: z.number().positive().default(1),
  // Flags a labour line as chargeable at the contractor's overtime_rate
  // rather than day_rate — set by the LLM based on job details (e.g.
  // "unsociable hours" access issues), but the actual rate lookup happens in
  // applyLabourRates, never trusted directly from the LLM's unit_price.
  overtime: z.boolean().default(false),
  assumed: z.boolean().default(false),
  assumption_note: nullishString,
});

export type LineItem = z.infer<typeof lineItemSchema>;

export const quoteDraftSchema = z.object({
  line_items: z.array(lineItemSchema).min(1),
});

export type QuoteDraft = z.infer<typeof quoteDraftSchema>;
