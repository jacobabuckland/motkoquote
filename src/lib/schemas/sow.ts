import { z } from "zod";
import { nullishString, materialsSupplySchema, type JobExtraction } from "@/lib/schemas/job";

export const sowRoomSchema = z.object({
  name: z.string(),
  dimensions: nullishString,
  work_items: z.array(z.string()).default([]),
});

export type SowRoom = z.infer<typeof sowRoomSchema>;

// Delta-only shape for a room: same as SowRoom, plus an optional list of
// previously-reported work items to drop from this room. This is the
// mechanism that makes corrections ("fourteen sockets... actually it's
// ten") actually work — work_items is otherwise append-only (see
// mergeSowDelta), so without an explicit removal signal a corrected-away
// fact would linger alongside its replacement forever.
export const sowRoomDeltaSchema = sowRoomSchema.extend({
  removed_work_items: z.array(z.string()).default([]),
});

export type SowRoomDelta = z.infer<typeof sowRoomDeltaSchema>;

const labourPlanSchema = z.object({
  people_count: z.number().int().positive().nullable().default(null),
  duration_days: z.number().positive().nullable().default(null),
  // Who, in plain words — "just me", "me and a labourer", "with a
  // subcontractor for the wiring". Distinct from people_count (a number):
  // this answers checklist question 1 (who's on site), people_count/
  // duration_days answer question 2 (how many days).
  crew_description: nullishString,
});

export type LabourPlan = z.infer<typeof labourPlanSchema>;

const deadlineSchema = z.object({
  // "Quote needed by Friday" — pressure on when the QUOTE is due.
  quote_by: nullishString,
  // "Job done before Christmas" — pressure on when the WORK is due.
  job_by: nullishString,
});

export type Deadline = z.infer<typeof deadlineSchema>;

// Checklist question 3: what materials are being supplied and by whom.
// materialsSupplySchema itself lives in job.ts (imported above) — see
// comment there. Nullable at the SowState level (null = not yet
// addressed); once set, even with both arrays empty, it means the
// contractor was asked and confirmed there's nothing notable — same
// convention as labour_plan/deadline below.

// Checklist question 5: costs already agreed with the customer before the
// quote is drafted. These, once set, override anything the pricing engine
// would otherwise calculate (see applyAgreedDayRate/applyAgreedFixedPrice).
const agreedCostsSchema = z.object({
  day_rate: z.number().positive().nullable().default(null),
  fixed_price: z.number().positive().nullable().default(null),
  deposit_amount: z.number().positive().nullable().default(null),
  notes: nullishString,
});

export type AgreedCosts = z.infer<typeof agreedCostsSchema>;

export const assumptionTreatment = z.enum(["excluded", "provisional_sum", "assumed_ok"]);

export const assumptionSchema = z.object({
  description: z.string(),
  treatment: assumptionTreatment,
});

export type Assumption = z.infer<typeof assumptionSchema>;

export const sowStateSchema = z.object({
  job_type: z.string(),
  rooms: z.array(sowRoomSchema).default([]),
  materials_mentioned: z.array(z.string()).default([]),
  // Occupancy, working-hours limits, room-by-room requirements, parking,
  // keys — constraints on HOW/WHEN the work can happen. Distinct from
  // existing_conditions below (state of the current installation).
  access_issues: nullishString,
  // State of the current installation/fabric — e.g. "old rubber cable
  // throughout". Not a working constraint, so it doesn't belong in
  // access_issues; kept separate so it renders under its own heading
  // instead of being mis-filed as an access note.
  existing_conditions: nullishString,
  timeline: nullishString,
  // People + duration if stated ("2 people, ~8 days"). Feeds timeline
  // synthesis (see sow-narrative.ts) when the contractor never states a
  // plain-English timeline directly.
  labour_plan: labourPlanSchema.nullable().default(null),
  deadline: deadlineSchema.nullable().default(null),
  // Checklist question 3 — see materialsSupplySchema above.
  materials_supply: materialsSupplySchema.nullable().default(null),
  // Checklist question 5 — see agreedCostsSchema above.
  agreed_costs: agreedCostsSchema.nullable().default(null),
  // Explicit in-scope items, e.g. making good/plastering chases.
  inclusions: z.array(z.string()).default([]),
  // Explicit out-of-scope items, e.g. "kitchen sockets staying".
  exclusions: z.array(z.string()).default([]),
  // Things the contractor said they couldn't verify or might need to
  // revisit, each with how it should be priced. Supersedes the old flat
  // `assumptions: string[]` — same mechanism, richer shape, still the one
  // source of truth for the SoW's "Assumptions" section.
  assumptions_and_unknowns: z.array(assumptionSchema).default([]),
  // Customer + site contact fields, captured live during the call so a
  // completed SoW is never missing who it's for. All nullable — the send
  // flow (see actions.ts) blocks on these being filled in, not this schema.
  customer_name: nullishString,
  site_address: nullishString,
  customer_phone: nullishString,
  customer_email: nullishString,
  complete: z.boolean().default(false),
  next_question: nullishString,
  // Written once, after the conversation completes — a short narrative
  // paragraph summarising the job and its assumptions in plain language.
  // Never produced turn-by-turn, so it's not part of sowDeltaSchema/merge.
  overview_narrative: nullishString,
  // How many times job_type has actually changed to a different value
  // mid-conversation (not just repeated). Internal bookkeeping for
  // mergeSowDelta's reclassification policy below — never set by the model
  // directly, so it isn't part of sowDeltaSchema.
  reclassification_count: z.number().int().nonnegative().default(0),
  // Set once, at job completion, from question-packs/fallback.ts — true
  // when the final job_type had no matching question pack. Persisted on
  // sow_json so which job types fall back most often is queryable later,
  // not just observable live. Never set by the model directly.
  used_generic_fallback: z.boolean().default(false),
});

export type SowState = z.infer<typeof sowStateSchema>;

// What the model returns per turn: only what's new or changed in the
// contractor's latest message, not the full accumulated state. Keeps output
// (and therefore turnaround latency) roughly constant instead of growing with
// every turn. `mergeSowDelta` below folds this into the running SowState.
export const sowDeltaSchema = z.object({
  job_type: nullishString,
  rooms: z.array(sowRoomDeltaSchema).default([]),
  materials_mentioned: z.array(z.string()).default([]),
  access_issues: nullishString,
  existing_conditions: nullishString,
  timeline: nullishString,
  labour_plan: labourPlanSchema.nullable().optional(),
  deadline: deadlineSchema.nullable().optional(),
  materials_supply: materialsSupplySchema.nullable().optional(),
  agreed_costs: agreedCostsSchema.nullable().optional(),
  inclusions: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
  assumptions_and_unknowns: z.array(assumptionSchema).default([]),
  customer_name: nullishString,
  site_address: nullishString,
  customer_phone: nullishString,
  customer_email: nullishString,
  complete: z.boolean().default(false),
  next_question: nullishString,
});

export type SowDelta = z.infer<typeof sowDeltaSchema>;

// JSON-schema parameters for the Realtime API's `update_sow` tool. A subset
// of SowDelta covering only job data — `complete`/`next_question` aren't
// here because flow control is a separate `finish_job` tool call; the
// Realtime model speaks its own follow-up question directly instead of
// emitting next_question text for a TTS step. Keep in sync with
// sowDeltaSchema by hand — no zod-to-json-schema dependency in this project.
//
// Every property carries a one-line `description` so the live model files
// facts into the right field instead of guessing (see field comments on
// sowStateSchema above for the fuller rationale on each split).
export const SOW_DELTA_TOOL_PARAMETERS = {
  type: "object",
  properties: {
    job_type: { type: "string", description: "The trade/type of job, e.g. 'plastering'." },
    rooms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          dimensions: { type: "string" },
          work_items: {
            type: "array",
            items: { type: "string" },
            description:
              "New or corrected work items for this room, written as complete facts (e.g. 'Install 10 double sockets, kitchen excluded'). Do not repeat items already reported unchanged.",
          },
          removed_work_items: {
            type: "array",
            items: { type: "string" },
            description:
              "Work items previously reported for this room that the contractor just corrected or retracted — match the wording you used when you first reported them. Always pair a removal with the corrected replacement in work_items. Example: you earlier reported work_items: ['fourteen double sockets'] for room 'Downstairs'; the contractor then says 'actually, scrap that — it's ten, four in the kitchen are staying' — call update_sow again with room 'Downstairs', removed_work_items: ['fourteen double sockets'], work_items: ['ten double sockets, four in the kitchen excluded'].",
          },
        },
        required: ["name", "work_items"],
      },
    },
    materials_mentioned: { type: "array", items: { type: "string" } },
    access_issues: {
      type: "string",
      description:
        "Constraints on how/when the work can happen: occupancy, working-hours limits, room-by-room requirements, parking, keys. NOT the state of the existing installation — that's existing_conditions. Leave this field out entirely if the contractor hasn't mentioned any — never write filler like 'no access issues' or 'none mentioned'.",
    },
    existing_conditions: {
      type: "string",
      description:
        "The state of the current installation/fabric the contractor described, e.g. 'old rubber cable throughout'. NOT a working constraint — that's access_issues. Leave this field out entirely if nothing was mentioned — never write filler like 'no notable existing conditions'.",
    },
    timeline: {
      type: "string",
      description: "A timeline the contractor stated directly in plain language, if any.",
    },
    labour_plan: {
      type: "object",
      description:
        "People and duration if stated, e.g. 'me and one other lad for about eight days' → people_count 2, duration_days 8. Used to synthesise a timeline when none is stated directly.",
      properties: {
        people_count: { type: "number" },
        duration_days: { type: "number" },
        crew_description: {
          type: "string",
          description: "Who's on site, in plain words, e.g. 'just me', 'me and a labourer', 'with a subcontractor for the wiring'.",
        },
      },
    },
    deadline: {
      type: "object",
      description: "Any stated date pressure — distinguish a deadline for the quote itself from a deadline for the job.",
      properties: {
        quote_by: { type: "string", description: "e.g. 'quote needed by Friday'." },
        job_by: { type: "string", description: "e.g. 'job done before Christmas'." },
      },
    },
    materials_supply: {
      type: "object",
      description:
        "Who's supplying materials. Set this even if the answer is 'we're supplying everything' or 'customer's supplying everything' — leave the other array empty in that case, don't omit the field.",
      properties: {
        contractor_supplied: {
          type: "array",
          items: { type: "string" },
          description: "Materials the contractor/tradesperson is supplying, e.g. 'sockets', 'cable'.",
        },
        customer_supplied: {
          type: "array",
          items: { type: "string" },
          description: "Materials the customer is supplying themselves, e.g. 'tiles', 'paint'.",
        },
      },
    },
    agreed_costs: {
      type: "object",
      description:
        "Any pricing already agreed directly with the customer, before this quote — a day rate, a fixed price, or a deposit. Set this even if nothing was agreed (all fields empty), so it's clear you asked.",
      properties: {
        day_rate: { type: "number", description: "Agreed day rate in GBP, if stated." },
        fixed_price: { type: "number", description: "Agreed fixed/total price in GBP, if stated." },
        deposit_amount: { type: "number", description: "Agreed deposit amount in GBP, if stated." },
        notes: { type: "string", description: "Any other detail about the agreed cost that doesn't fit the fields above." },
      },
    },
    inclusions: {
      type: "array",
      items: { type: "string" },
      description: "Explicit in-scope items the contractor confirmed, e.g. 'making good included'.",
    },
    exclusions: {
      type: "array",
      items: { type: "string" },
      description: "Explicit out-of-scope items the contractor stated, e.g. 'kitchen sockets staying', 'decorating by customer'.",
    },
    assumptions_and_unknowns: {
      type: "array",
      description:
        "Anything the contractor said they couldn't verify or might need to revisit, e.g. 'couldn't check earthing/bonding, may need upgrading'.",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          treatment: {
            type: "string",
            enum: ["excluded", "provisional_sum", "assumed_ok"],
            description:
              "How this should be priced: 'excluded' if it's out of scope entirely, 'provisional_sum' if it may need a separate quote later, 'assumed_ok' if the quote assumes it's fine and only needs flagging.",
          },
        },
        required: ["description", "treatment"],
      },
    },
    customer_name: { type: "string", description: "The customer's name, if stated." },
    site_address: { type: "string", description: "The site/job address, if stated — include the postcode if given." },
    customer_phone: { type: "string", description: "The customer's phone number, if stated." },
    customer_email: { type: "string", description: "The customer's email address, if stated." },
  },
  required: [],
} as const;

// Wraps an `update_sow` tool-call payload (job data only, no flow-control
// fields) into the shape mergeSowDelta expects, then folds it into state.
export const mergeSowToolDelta = (current: SowState | null, raw: unknown): SowState => {
  const delta = sowDeltaSchema.parse(raw);
  return mergeSowDelta(current, delta);
};

const normalizeRoomName = (name: string) => name.trim().toLowerCase();
const normalizeJobType = (jobType: string) => jobType.trim().toLowerCase();
const normalizeFact = (value: string) => value.trim().toLowerCase();

// How many times the contractor's job_type is allowed to actually change
// mid-conversation (as opposed to just being repeated). The model sometimes
// second-guesses an early classification once more detail comes out — one
// reclassification accommodates that. Beyond that, further "changes" are far
// more likely to be the model drifting/misreporting than a real correction,
// so we hold the job_type steady rather than let it thrash for the rest of
// the call.
export const MAX_JOB_TYPE_RECLASSIFICATIONS = 1;

// Resolves job_type + reclassification_count for the next state. Returns
// the existing job_type unchanged once the reclassification budget is
// spent, even if the model keeps reporting a different one.
const resolveJobType = (
  base: SowState,
  deltaJobType: string | undefined,
): Pick<SowState, "job_type" | "reclassification_count"> => {
  if (!deltaJobType) {
    return { job_type: base.job_type, reclassification_count: base.reclassification_count };
  }
  const isFirstClassification = base.job_type === "";
  const isActualChange =
    !isFirstClassification && normalizeJobType(deltaJobType) !== normalizeJobType(base.job_type);

  if (!isActualChange) {
    return { job_type: deltaJobType, reclassification_count: base.reclassification_count };
  }
  if (base.reclassification_count >= MAX_JOB_TYPE_RECLASSIFICATIONS) {
    return { job_type: base.job_type, reclassification_count: base.reclassification_count };
  }
  return { job_type: deltaJobType, reclassification_count: base.reclassification_count + 1 };
};

// A removal matches a work item if either fully contains the other once
// normalized — a conservative fuzzy match that tolerates the model
// paraphrasing slightly between the original report and the correction,
// without being so loose it drops unrelated items.
const matchesRemoval = (workItem: string, removal: string) => {
  const a = normalizeFact(workItem);
  const b = normalizeFact(removal);
  return a.includes(b) || b.includes(a);
};

// Appends new strings to a list, skipping anything already present
// (case/whitespace-insensitive). Used for cumulative list fields.
const dedupeAppend = (base: string[], additions: string[]): string[] => {
  const result = [...base];
  for (const item of additions) {
    if (!result.some((existing) => normalizeFact(existing) === normalizeFact(item))) result.push(item);
  }
  return result;
};

export const EMPTY_SOW_STATE: SowState = {
  job_type: "",
  rooms: [],
  materials_mentioned: [],
  access_issues: undefined,
  existing_conditions: undefined,
  timeline: undefined,
  labour_plan: null,
  deadline: null,
  materials_supply: null,
  agreed_costs: null,
  inclusions: [],
  exclusions: [],
  assumptions_and_unknowns: [],
  customer_name: undefined,
  site_address: undefined,
  customer_phone: undefined,
  customer_email: undefined,
  complete: false,
  next_question: undefined,
  reclassification_count: 0,
  used_generic_fallback: false,
};

// Deterministically folds a turn's delta into the running SowState. Room
// matching is by name (case-insensitive) so a room mentioned again just gets
// its new work items appended rather than duplicated; unmentioned fields
// (materials, assumptions, access_issues, timeline, job_type) simply carry
// forward from the current state. Idempotent even if the model over-reports
// unchanged data, so correctness never depends on the model following the
// "only report deltas" instruction perfectly.
//
// Corrections: scalar fields (access_issues, existing_conditions, timeline,
// customer_*, site_address) are last-value-wins by construction — a new
// delta value simply replaces the old one. List fields that are genuinely
// cumulative (materials_mentioned, inclusions, exclusions) append-dedupe.
// Room work_items are the one place a correction needs an explicit signal
// (removed_work_items) since two different facts can otherwise look like
// two unrelated strings to append.
export const mergeSowDelta = (current: SowState | null, delta: SowDelta): SowState => {
  const base: SowState = current ?? EMPTY_SOW_STATE;

  const rooms = base.rooms.map((room) => ({ ...room, work_items: [...room.work_items] }));
  for (const deltaRoom of delta.rooms) {
    const idx = rooms.findIndex(
      (room) => normalizeRoomName(room.name) === normalizeRoomName(deltaRoom.name),
    );
    if (idx === -1) {
      rooms.push({ name: deltaRoom.name, dimensions: deltaRoom.dimensions, work_items: deltaRoom.work_items });
      continue;
    }
    const existing = rooms[idx]!;
    if (deltaRoom.removed_work_items.length > 0) {
      existing.work_items = existing.work_items.filter(
        (item) => !deltaRoom.removed_work_items.some((removed) => matchesRemoval(item, removed)),
      );
    }
    for (const item of deltaRoom.work_items) {
      if (!existing.work_items.includes(item)) existing.work_items.push(item);
    }
    existing.dimensions = deltaRoom.dimensions ?? existing.dimensions;
  }

  const materials_mentioned = [...base.materials_mentioned];
  for (const material of delta.materials_mentioned) {
    if (!materials_mentioned.includes(material)) materials_mentioned.push(material);
  }

  const inclusions = [...base.inclusions];
  for (const inclusion of delta.inclusions) {
    if (!inclusions.some((existing) => normalizeFact(existing) === normalizeFact(inclusion))) {
      inclusions.push(inclusion);
    }
  }

  const exclusions = [...base.exclusions];
  for (const exclusion of delta.exclusions) {
    if (!exclusions.some((existing) => normalizeFact(existing) === normalizeFact(exclusion))) {
      exclusions.push(exclusion);
    }
  }

  const assumptions_and_unknowns = [...base.assumptions_and_unknowns];
  for (const assumption of delta.assumptions_and_unknowns) {
    const existingIdx = assumptions_and_unknowns.findIndex(
      (a) => normalizeFact(a.description) === normalizeFact(assumption.description),
    );
    if (existingIdx === -1) assumptions_and_unknowns.push(assumption);
    else assumptions_and_unknowns[existingIdx] = assumption;
  }

  const labour_plan =
    delta.labour_plan === undefined
      ? base.labour_plan
      : delta.labour_plan === null
        ? base.labour_plan
        : {
            people_count: delta.labour_plan.people_count ?? base.labour_plan?.people_count ?? null,
            duration_days: delta.labour_plan.duration_days ?? base.labour_plan?.duration_days ?? null,
            crew_description: delta.labour_plan.crew_description ?? base.labour_plan?.crew_description,
          };

  const deadline =
    delta.deadline === undefined
      ? base.deadline
      : delta.deadline === null
        ? base.deadline
        : {
            quote_by: delta.deadline.quote_by ?? base.deadline?.quote_by,
            job_by: delta.deadline.job_by ?? base.deadline?.job_by,
          };

  // Object presence (even with empty arrays) means the question was
  // addressed — see materialsSupplySchema comment above.
  const materials_supply =
    delta.materials_supply === undefined
      ? base.materials_supply
      : delta.materials_supply === null
        ? base.materials_supply
        : {
            contractor_supplied: dedupeAppend(
              base.materials_supply?.contractor_supplied ?? [],
              delta.materials_supply.contractor_supplied,
            ),
            customer_supplied: dedupeAppend(
              base.materials_supply?.customer_supplied ?? [],
              delta.materials_supply.customer_supplied,
            ),
          };

  // Object presence (even with all fields empty) means the question was
  // addressed — see agreedCostsSchema comment above.
  const agreed_costs =
    delta.agreed_costs === undefined
      ? base.agreed_costs
      : delta.agreed_costs === null
        ? base.agreed_costs
        : {
            day_rate: delta.agreed_costs.day_rate ?? base.agreed_costs?.day_rate ?? null,
            fixed_price: delta.agreed_costs.fixed_price ?? base.agreed_costs?.fixed_price ?? null,
            deposit_amount: delta.agreed_costs.deposit_amount ?? base.agreed_costs?.deposit_amount ?? null,
            notes: delta.agreed_costs.notes ?? base.agreed_costs?.notes,
          };

  return {
    ...resolveJobType(base, delta.job_type),
    rooms,
    materials_mentioned,
    access_issues: delta.access_issues ?? base.access_issues,
    existing_conditions: delta.existing_conditions ?? base.existing_conditions,
    timeline: delta.timeline ?? base.timeline,
    labour_plan,
    deadline,
    materials_supply,
    agreed_costs,
    inclusions,
    exclusions,
    assumptions_and_unknowns,
    customer_name: delta.customer_name ?? base.customer_name,
    site_address: delta.site_address ?? base.site_address,
    customer_phone: delta.customer_phone ?? base.customer_phone,
    customer_email: delta.customer_email ?? base.customer_email,
    complete: delta.complete,
    next_question: delta.next_question,
    used_generic_fallback: base.used_generic_fallback,
  };
};

// "Approx. 8 working days, 2-person team" from labour_plan, falling back to
// a stated timeline, falling back to a neutral "to be confirmed" — never
// the old, slightly alarming-sounding "not specified yet". Appends any
// stated job deadline (checklist question 4) as a trailing sentence so the
// SoW's timeline always reflects when the customer needs it done by.
export const synthesizeTimeline = (
  sow: Pick<SowState, "timeline" | "labour_plan" | "deadline">,
): string => {
  let base: string;
  if (sow.labour_plan && (sow.labour_plan.people_count || sow.labour_plan.duration_days)) {
    const { people_count, duration_days } = sow.labour_plan;
    const parts: string[] = [];
    if (duration_days) parts.push(`Approx. ${duration_days} working day${duration_days === 1 ? "" : "s"}`);
    if (people_count) parts.push(`${people_count}-person team`);
    base = parts.length > 0 ? parts.join(", ") : sow.timeline || "To be confirmed before work begins.";
  } else {
    base = sow.timeline || "To be confirmed before work begins.";
  }
  if (sow.deadline?.job_by) {
    return `${base} Needed by: ${sow.deadline.job_by}.`;
  }
  return base;
};

// Flattens the room-by-room SoW into the flat shape the existing quote
// drafter, knowledge layer, and material-price memory already consume.
export const sowToExtraction = (sow: SowState): JobExtraction => {
  const scopeItems = sow.rooms.flatMap((room) =>
    room.work_items.map((item) =>
      room.dimensions ? `${room.name} (${room.dimensions}): ${item}` : `${room.name}: ${item}`,
    ),
  );
  const dimensions = sow.rooms
    .filter((room) => room.dimensions)
    .map((room) => `${room.name}: ${room.dimensions}`)
    .join("; ");

  const notesParts: string[] = [];
  if (sow.existing_conditions) notesParts.push(`Existing conditions: ${sow.existing_conditions}`);
  if (sow.inclusions.length > 0) notesParts.push(`Included: ${sow.inclusions.join("; ")}`);
  if (sow.exclusions.length > 0) notesParts.push(`Excluded: ${sow.exclusions.join("; ")}`);
  if (sow.assumptions_and_unknowns.length > 0) {
    notesParts.push(
      `Assumptions: ${sow.assumptions_and_unknowns.map((a) => `${a.description} (${a.treatment})`).join("; ")}`,
    );
  }
  if (sow.deadline?.quote_by) notesParts.push(`Quote needed by: ${sow.deadline.quote_by}`);
  if (sow.agreed_costs) {
    const costParts: string[] = [];
    if (sow.agreed_costs.day_rate) costParts.push(`day rate £${sow.agreed_costs.day_rate}`);
    if (sow.agreed_costs.fixed_price) costParts.push(`fixed price £${sow.agreed_costs.fixed_price}`);
    if (sow.agreed_costs.deposit_amount) costParts.push(`deposit £${sow.agreed_costs.deposit_amount}`);
    if (sow.agreed_costs.notes) costParts.push(sow.agreed_costs.notes);
    if (costParts.length > 0) notesParts.push(`Agreed costs: ${costParts.join(", ")}`);
  }

  return {
    job_type: sow.job_type,
    scope_items: scopeItems,
    dimensions: dimensions || undefined,
    materials_mentioned: sow.materials_mentioned,
    access_issues: sow.access_issues,
    timeline: synthesizeTimeline(sow),
    notes: notesParts.length > 0 ? notesParts.join(" | ") : undefined,
    crew_description: sow.labour_plan?.crew_description,
    materials_supply: sow.materials_supply,
  };
};

// The five practical checklist questions Motko asks after the initial job
// description, in the order they should be asked. Each id maps to a
// plain-language, trade-friendly prompt and a check for whether the
// contractor already covered it (either unprompted during the initial
// description, or via a previous answer this call).
export type ChecklistQuestionId = "crew" | "duration" | "materials_supply" | "deadline" | "agreed_costs";

export const CHECKLIST_QUESTIONS: Record<ChecklistQuestionId, string> = {
  crew: "Who's going to be on site — just you, or will someone else be with you, like a labourer, subcontractor, or apprentice?",
  duration: "Which days will you be on site, or roughly how many days is the job?",
  materials_supply: "Are you supplying the materials, or is the customer? If you're supplying some and they're supplying others, which is which?",
  deadline: "When does the customer need this done by?",
  agreed_costs: "Has anything already been agreed with the customer on cost — a day rate, a fixed price, or a deposit?",
};

// Returns, in checklist order, the questions not yet answered by the
// current SoW state. A question counts as answered once its corresponding
// field has been explicitly set — including "asked and there's nothing to
// report" (an object with empty arrays/null sub-fields), per the
// nullable-object convention used throughout this file.
export const getUnansweredChecklistQuestions = (sow: SowState): ChecklistQuestionId[] => {
  const unanswered: ChecklistQuestionId[] = [];
  if (!sow.labour_plan?.crew_description) unanswered.push("crew");
  if (sow.labour_plan?.duration_days == null) unanswered.push("duration");
  if (!sow.materials_supply) unanswered.push("materials_supply");
  if (!sow.deadline?.job_by) unanswered.push("deadline");
  if (!sow.agreed_costs) unanswered.push("agreed_costs");
  return unanswered;
};
