import { z } from "zod";

export const nullishString = z
  .string()
  .nullable()
  .transform((value) => value ?? undefined)
  .optional();

// Who's supplying materials — lives here (rather than sow.ts) so both
// job.ts and sow.ts can depend on it without a circular import; sow.ts
// imports this schema for its own sowStateSchema/sowDeltaSchema fields.
export const materialsSupplySchema = z.object({
  contractor_supplied: z.array(z.string()).default([]),
  customer_supplied: z.array(z.string()).default([]),
});

export type MaterialsSupply = z.infer<typeof materialsSupplySchema>;

export const jobExtractionSchema = z.object({
  job_type: z.string(),
  scope_items: z.array(z.string()).default([]),
  dimensions: nullishString,
  materials_mentioned: z.array(z.string()).default([]),
  access_issues: nullishString,
  timeline: nullishString,
  notes: nullishString,
  // Who's on site, in plain words — e.g. "just me", "me and a labourer".
  crew_description: nullishString,
  // Who's supplying materials, if the contractor said. Nullable/optional:
  // absent means it wasn't captured, present (even with empty arrays)
  // means it was explicitly asked and confirmed.
  materials_supply: materialsSupplySchema.nullable().optional(),
});

export type JobExtraction = z.infer<typeof jobExtractionSchema>;

// One priced member of a labour line's crew. The label comes from
// team_members (name + role) — never LLM prose — and day_rate is a confirmed
// contractor/team number looked up in code by compileDraftToLineItems. This
// is the source of truth for a labour line's amount: lineItemTotal sums
// days * day_rate across this array, so a mixed-rate crew (owner £340 +
// apprentice £120) is priced correctly on a single line.
export const linePersonSchema = z.object({
  label: z.string(),
  days: z.number().nonnegative(),
  day_rate: z.number().nonnegative(),
});

export type LinePerson = z.infer<typeof linePersonSchema>;

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
  // unaffected. Superseded by `people` when present (a per-person breakdown);
  // kept for legacy line items and non-labour lines.
  people_count: z.number().positive().default(1),
  // Flags a labour line as chargeable at the contractor's overtime_rate
  // rather than day_rate. The actual rate lookup happens in
  // compileDraftToLineItems, never trusted directly from the LLM.
  overtime: z.boolean().default(false),
  assumed: z.boolean().default(false),
  assumption_note: nullishString,
  // Per-person crew breakdown for labour lines (source of truth for the
  // amount when present — see linePersonSchema / lineItemTotal). Optional so
  // legacy quotes and every non-labour line are unaffected.
  people: z.array(linePersonSchema).optional(),
  // Task sub-bullets rendered under a labour line WITHOUT amounts — how the
  // pricing contract shows a task breakdown without letting a task-split line
  // re-count days already in the crew's person-day pool.
  includes_tasks: z.array(z.string()).optional(),
  // Materials only: who's buying. "customer" lines price at £0 and carry a
  // supplied-by note; "contractor" lines get the markup applied in code.
  supplied_by: z.enum(["contractor", "customer"]).optional(),
  // Marks a provisional-sum line (e.g. "soil stack, condition unknown") —
  // clearly editable, priced from the drafted suggested amount.
  provisional: z.boolean().optional(),
  // Provenance: the rate card this line's price came from, if any.
  rate_card_id: z.string().optional(),
  // Set true when the contractor manually overrode a computed amount in the
  // editor, so a later recompute preserves their figure.
  edited: z.boolean().optional(),
});

export type LineItem = z.infer<typeof lineItemSchema>;

// ---------------------------------------------------------------------------
// Drafting output contract — what the LLM is allowed to emit.
//
// The governing rule: the LLM proposes STRUCTURE, code computes every amount.
// So labour and rate-card lines carry NO prices at all (code looks them up),
// materials carry an *estimated* cost flagged as a proposal, and provisional
// sums carry a suggested figure the contractor can edit. compileDraftToLineItems
// turns these into priced LineItems deterministically.
// ---------------------------------------------------------------------------

// A person on a labour line, referenced by team_members id or the literal
// "owner" (the contractor themselves). NO rate — code looks it up.
export const draftPersonSchema = z.object({
  ref: z.string(),
  days: z.number().positive(),
});

export const draftLabourSchema = z.object({
  kind: z.literal("labour"),
  description: z.string(),
  people: z.array(draftPersonSchema).min(1),
  overtime: z.boolean().default(false),
  includes_tasks: z.array(z.string()).default([]),
});

export const draftMaterialSchema = z.object({
  kind: z.literal("material"),
  description: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  // A proposal only, in pence, flagged assumed on the priced line. Absent for
  // customer-supplied materials (they price at £0).
  estimated_unit_cost_pence: z.number().nonnegative().nullish(),
  supplied_by: z.enum(["contractor", "customer"]),
});

export const draftRateCardSchema = z.object({
  kind: z.literal("rate_card"),
  rate_card_id: z.string(),
  quantity: z.number().positive(),
  description: z.string(),
});

export const draftProvisionalSchema = z.object({
  kind: z.literal("provisional"),
  description: z.string(),
  suggested_amount_pence: z.number().nonnegative(),
  reason: z.string(),
});

export const draftLineItemSchema = z.discriminatedUnion("kind", [
  draftLabourSchema,
  draftMaterialSchema,
  draftRateCardSchema,
  draftProvisionalSchema,
]);

export type DraftLineItem = z.infer<typeof draftLineItemSchema>;

export const quoteDraftSchema = z.object({
  line_items: z.array(draftLineItemSchema).min(1),
});

export type QuoteDraft = z.infer<typeof quoteDraftSchema>;
