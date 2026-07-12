import { z } from "zod";

export const slotTypeSchema = z.enum(["number", "text", "boolean", "choice"]);

export const slotDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: slotTypeSchema,
  // "required" slots block completion (the gap-check-before-drafting step);
  // "assumable" slots are fine to leave unanswered — resolveSlotDefault
  // fills them from a rate card or the pack's own default_value instead.
  priority: z.enum(["required", "assumable"]),
  choices: z.array(z.string()).optional(),
  // Plain-language note on how this slot affects pricing (e.g. "1.5x
  // labour lines" for difficult access) — narrated into the quote's
  // assumptions block, not machine-evaluated against quote-math.
  pricing_effect: z.string().optional(),
  // Static fallback used when the slot is "assumable" and no contractor
  // rate card resolves it during the call (see resolveSlotDefault).
  default_value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export type SlotDef = z.infer<typeof slotDefSchema>;

// One trade/job-type's set of interview slots — the deterministic backbone
// of the two-stage classify-then-interrogate voice flow: job_type is
// classified first, then this pack's slots drive what's asked next.
export const questionPackSchema = z.object({
  job_type: z.string(),
  slots: z.array(slotDefSchema).min(1),
});

export type QuestionPack = z.infer<typeof questionPackSchema>;
