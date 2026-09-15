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
  // Who is responsible OVERALL — a stated fact, not one inferred from which
  // list happens to be empty.
  //
  // Inferring it is what put "Materials will be supplied by: **Customer**" on a
  // £7,200 plastering contract (job f453b3ae): the contractor said the customer
  // was bringing the plaster, which stores as customer_supplied ["plaster"] and
  // contractor_supplied [], and the derivation read the empty list as "the
  // contractor supplies nothing". Naming what the OTHER party brings is the
  // natural way to say it, so the shape is common rather than freakish.
  //
  // The lists keep their meaning: which specific items, where that was said.
  // OPTIONAL, with no default, following `pricing.mode` in sow.ts and for the
  // same stated reason: "an absent mode is now absent" rather than a guessed
  // value. Absent here means the row predates P2-15 or the question never
  // landed, and materialsResponsibility reads that as "fall back to the old
  // derivation" rather than reinterpreting stored data.
  //
  // Not the PFIX-4 trap that made `has_pricing_history` optional-and-dangerous:
  // there, omission silently took the UNSAFE branch. Here omission takes the
  // legacy branch, which is exactly what an old row must get, and it is pinned
  // by tests rather than assumed.
  //
  // It also keeps every existing fixture valid, so no frozen acceptance test
  // needs widening and the pipeline harness's recorded prompt hashes still
  // match — a null key serialised into every prompt would have invalidated
  // them, and re-recording needs live model calls.
  responsibility: z.enum(["contractor", "customer", "split"]).optional(),
  // How much material is needed — "about 40 square metres", "you work it out",
  // or undefined (not yet asked). Added in #749: the materials question now asks
  // WHO supplies (responsibility), HOW MUCH is needed (quantity_guidance), and
  // WHAT SPECIFICALLY (the item arrays). A partial answer keeps the slot
  // unanswered, so all three parts are captured together.
  //
  // Optional like responsibility above: a row that predates #749 has no
  // quantity_guidance field, and the answeredness check handles that gracefully
  // (legacy rows are considered answered if responsibility is set).
  quantity_guidance: nullishString,
});

export type MaterialsSupply = z.infer<typeof materialsSupplySchema>;

export const jobExtractionSchema = z.object({
  job_type: z.string(),
  scope_items: z.array(z.string()).default([]),
  // Catch-all for clearly-requested work that fits no other slot — so a
  // spoken item can never be silently dropped between intake and drafting.
  // The drafter must produce a line for each of these (matching a rate card
  // where it can), never omit them.
  additional_items: z.array(z.string()).default([]),
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

// Provenance: where a line item came from (transcript, contractor, or system-generated).
export const lineItemProvenanceSchema = z.object({
  source: z.enum(["transcript", "contractor", "system-generated"]),
  // When source is "transcript", the exact span from the conversation that
  // produced this line. Absent for contractor-sourced and system-generated lines.
  transcript_span: z.string().optional(),
});

export type LineItemProvenance = z.infer<typeof lineItemProvenanceSchema>;

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
  people: z.array(linePersonSchema).nullish(),
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
  // No rate was available to price this line, so its amount is ABSENT, not
  // zero. Distinct from a line the contractor deliberately zeroed (a goodwill
  // callout, a customer-supplied material shown for scope): those are real
  // £0.00 figures and stay that way. Set by compileDraftToLineItems, which is
  // the only place that knows a rate lookup came back empty. Optional so every
  // quote drafted before this existed is unaffected.
  unpriced: z.boolean().optional(),
  // Provenance: the rate card this line's price came from, if any.
  rate_card_id: z.string().optional(),
  // Set true when the contractor manually overrode a computed amount in the
  // editor, so a later recompute preserves their figure.
  edited: z.boolean().optional(),
  // Customer-facing note that renders ON documents — assumption context,
  // provisional-sum explanations, supplied-by clarifications. The other note
  // channel (contractor_flag) is NEVER stored here: it must not reach a
  // customer view. Distinct from assumption_note (tied to `assumed`); this
  // renders whenever present.
  customer_note: nullishString,
  // Where this line came from: transcript span or contractor-added/edited.
  // Optional so legacy quotes (written before this field existed) parse
  // unchanged. Absent provenance means "unknown", not "unsourced" — never
  // flag historical quotes into a review state nobody asked for.
  provenance: lineItemProvenanceSchema.optional(),
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

// The two note channels every draft line may carry. Kept strictly separate so
// the compiler can route them: customer_note onto the rendered line,
// contractor_flag off every customer-facing surface into the editor only.
const draftNoteChannels = {
  // Renders ON the document — assumption context, provisional-sum
  // explanations, supplied-by clarifications. Nothing addressed to the
  // contractor or the app belongs here.
  customer_note: nullishString,
  // NEVER renders on any PDF or customer view — verification requests, rate
  // uncertainty, "confirm X before issuing". Surfaced only in the editor.
  contractor_flag: nullishString,
};

export const draftLabourSchema = z.object({
  kind: z.literal("labour"),
  description: z.string(),
  people: z.array(draftPersonSchema).min(1),
  overtime: z.boolean().default(false),
  includes_tasks: z.array(z.string()).default([]),
  ...draftNoteChannels,
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
  ...draftNoteChannels,
});

export const draftRateCardSchema = z.object({
  kind: z.literal("rate_card"),
  rate_card_id: z.string(),
  quantity: z.number().positive(),
  description: z.string(),
  ...draftNoteChannels,
});

export const draftProvisionalSchema = z.object({
  kind: z.literal("provisional"),
  description: z.string(),
  suggested_amount_pence: z.number().nonnegative(),
  reason: z.string(),
  ...draftNoteChannels,
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
  // Job-level flags for the contractor that don't attach to one line — e.g. an
  // unknown person mentioned in the call who isn't in team_members ("a mate's
  // helping Tuesday"). NEVER renders on a customer document; shown in the
  // editor only.
  contractor_flags: z.array(z.string()).default([]),
});

export type QuoteDraft = z.infer<typeof quoteDraftSchema>;

// What a resilient parse had to throw away, so the contractor can be told.
export type DroppedDraftLine = { description: string; reason: string };

const describeDraftLine = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return "an unreadable line";
  const line = value as { description?: unknown; kind?: unknown };
  if (typeof line.description === "string" && line.description.trim()) {
    return line.description.trim();
  }
  return typeof line.kind === "string" ? `an unnamed ${line.kind} line` : "an unnamed line";
};

/**
 * Why a line could not be used, in words a contractor can act on.
 *
 * Never the upstream prose (A6): Zod's own "Too small: expected number to be
 * >=0" is accurate and useless to the person reading it. The negative-amount
 * case gets named outright because it is the common one and it means something
 * specific — the model was reaching for a reduction, which a quote cannot yet
 * carry, so the contractor needs to know to apply it themselves.
 */
const explainDraftLineFailure = (error: z.ZodError): string => {
  const negativeAmount = error.issues.some(
    (issue) => issue.code === "too_small" && issue.path.includes("suggested_amount_pence"),
  );
  if (negativeAmount) return "it was a reduction, and a quote can't carry one yet";
  return "it wasn't a shape a quote line can take";
};

/**
 * Parse a drafting response, losing at most the lines that are unusable.
 *
 * `quoteDraftSchema.parse` threw, and one bad line took the whole quote with
 * it: a ZodError out of the server action, HTTP 500 from POST /jobs/new, and
 * no draft at all. Voice run 14 on 15 Sep produced nothing for that reason —
 * the model returned a NEGATIVE `suggested_amount_pence`, which is the only
 * shape it has for the 5% discount that script asks for, and
 * `draftProvisionalSchema` requires a non-negative amount.
 *
 * The schema stays strict. A negative provisional sum is not a charge anyone
 * could raise, and coercing it would put a wrong number on a customer document
 * rather than no number. What changes is the blast radius: an unusable line is
 * dropped and REPORTED, and every other line the model got right still reaches
 * the quote.
 *
 * Throws only when the response is not a draft at all, or when no line
 * survives — a quote with no lines is not a quote, which is what the schema's
 * `.min(1)` already says.
 */
export const parseQuoteDraft = (
  raw: unknown,
): { draft: QuoteDraft; dropped: DroppedDraftLine[] } => {
  const whole = quoteDraftSchema.safeParse(raw);
  if (whole.success) return { draft: whole.data, dropped: [] };

  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { line_items?: unknown }).line_items)) {
    throw whole.error;
  }

  const kept: DraftLineItem[] = [];
  const dropped: DroppedDraftLine[] = [];
  for (const candidate of (raw as { line_items: unknown[] }).line_items) {
    const line = draftLineItemSchema.safeParse(candidate);
    if (line.success) {
      kept.push(line.data);
      continue;
    }
    dropped.push({
      description: describeDraftLine(candidate),
      reason: explainDraftLineFailure(line.error),
    });
  }

  if (kept.length === 0) throw whole.error;

  const flags = z.array(z.string()).safeParse((raw as { contractor_flags?: unknown }).contractor_flags);
  return {
    draft: { line_items: kept, contractor_flags: flags.success ? flags.data : [] },
    dropped,
  };
};

// Shown in the editor when a line had to be dropped. Contractor-facing only —
// it names something that is NOT on the quote, which is precisely what they
// need to know before sending.
export const droppedDraftLineFlag = (line: DroppedDraftLine): string =>
  `Not on this quote: Motko proposed "${line.description}" but could not price it ` +
  `(${line.reason}). Add it by hand if the job needs it.`;
