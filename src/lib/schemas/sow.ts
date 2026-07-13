import { z } from "zod";
import { nullishString, type JobExtraction } from "@/lib/schemas/job";

export const sowRoomSchema = z.object({
  name: z.string(),
  dimensions: nullishString,
  work_items: z.array(z.string()).default([]),
});

export type SowRoom = z.infer<typeof sowRoomSchema>;

export const sowStateSchema = z.object({
  job_type: z.string(),
  rooms: z.array(sowRoomSchema).default([]),
  materials_mentioned: z.array(z.string()).default([]),
  access_issues: nullishString,
  timeline: nullishString,
  assumptions: z.array(z.string()).default([]),
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
  rooms: z.array(sowRoomSchema).default([]),
  materials_mentioned: z.array(z.string()).default([]),
  access_issues: nullishString,
  timeline: nullishString,
  assumptions: z.array(z.string()).default([]),
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
          work_items: { type: "array", items: { type: "string" } },
        },
        required: ["name", "work_items"],
      },
    },
    materials_mentioned: { type: "array", items: { type: "string" } },
    access_issues: { type: "string" },
    timeline: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
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

// Deterministically folds a turn's delta into the running SowState. Room
// matching is by name (case-insensitive) so a room mentioned again just gets
// its new work items appended rather than duplicated; unmentioned fields
// (materials, assumptions, access_issues, timeline, job_type) simply carry
// forward from the current state. Idempotent even if the model over-reports
// unchanged data, so correctness never depends on the model following the
// "only report deltas" instruction perfectly.
export const mergeSowDelta = (current: SowState | null, delta: SowDelta): SowState => {
  const base: SowState = current ?? {
    job_type: "",
    rooms: [],
    materials_mentioned: [],
    access_issues: undefined,
    timeline: undefined,
    assumptions: [],
    complete: false,
    next_question: undefined,
    reclassification_count: 0,
    used_generic_fallback: false,
  };

  const rooms = base.rooms.map((room) => ({ ...room, work_items: [...room.work_items] }));
  for (const deltaRoom of delta.rooms) {
    const idx = rooms.findIndex(
      (room) => normalizeRoomName(room.name) === normalizeRoomName(deltaRoom.name),
    );
    if (idx === -1) {
      rooms.push(deltaRoom);
      continue;
    }
    const existing = rooms[idx]!;
    for (const item of deltaRoom.work_items) {
      if (!existing.work_items.includes(item)) existing.work_items.push(item);
    }
    existing.dimensions = deltaRoom.dimensions ?? existing.dimensions;
  }

  const materials_mentioned = [...base.materials_mentioned];
  for (const material of delta.materials_mentioned) {
    if (!materials_mentioned.includes(material)) materials_mentioned.push(material);
  }

  const assumptions = [...base.assumptions];
  for (const assumption of delta.assumptions) {
    if (!assumptions.includes(assumption)) assumptions.push(assumption);
  }

  return {
    ...resolveJobType(base, delta.job_type),
    rooms,
    materials_mentioned,
    access_issues: delta.access_issues ?? base.access_issues,
    timeline: delta.timeline ?? base.timeline,
    assumptions,
    complete: delta.complete,
    next_question: delta.next_question,
    used_generic_fallback: base.used_generic_fallback,
  };
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

  return {
    job_type: sow.job_type,
    scope_items: scopeItems,
    dimensions: dimensions || undefined,
    materials_mentioned: sow.materials_mentioned,
    access_issues: sow.access_issues,
    timeline: sow.timeline,
    notes: sow.assumptions.length > 0 ? sow.assumptions.join("; ") : undefined,
  };
};
