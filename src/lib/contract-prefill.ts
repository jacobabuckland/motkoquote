// What the contract form starts with, derived from the job the contract is for.
//
// The form used to be handed only the scope and access notes, so "Client
// address" and "Client phone" opened empty on every contract — even though both
// were captured during intake and both were already printed on the statement of
// work the customer had been sent. Making a tradesperson retype what he
// dictated ten minutes earlier is the specific indignity this product exists to
// remove.
//
// Pure, so what the form receives is bound by a test rather than by reading a
// prop spread in a server component that cannot easily be rendered.

import { materialsResponsibility } from "@/lib/materials-summary";
import {
  durationFromDays,
  durationHintFromTimeline,
  startDateFromWorkingDates,
  startDateHintFromWorkingDates,
  type DurationUnit,
} from "@/lib/contracts/dates";
import type { MaterialsSupply } from "@/lib/schemas/job";

export type ContractPrefillJob = {
  customer: { contact: { phone?: string; address?: string } | null } | null;
  extracted_json: {
    scope_items?: string[];
    access_issues?: string;
    materials_supply?: MaterialsSupply | null;
  } | null;
  // The parsed SOW, where the caller has it. The dashboard's query doesn't
  // select sow_json, so this is optional — it only ever adds a fallback.
  sow?: { site_address?: string | null } | null;
} | null;

export type ContractPrefill = {
  scope_of_work: string;
  access_arrangements: string;
  client_address: string;
  client_phone: string;
  site_address: string;
  materials_by: string;
  materials_notes: string;
};

export const contractPrefillFromJob = (job: ContractPrefillJob): ContractPrefill => ({
  scope_of_work: (job?.extracted_json?.scope_items ?? []).join("; "),
  access_arrangements: job?.extracted_json?.access_issues ?? "",
  // Empty string rather than undefined: the form's fields are controlled, and
  // an absent value must leave a usable empty input, never placeholder text
  // presented as captured data.
  client_address: job?.customer?.contact?.address ?? "",
  client_phone: job?.customer?.contact?.phone ?? "",
  // The same captured value, into the field it was actually captured under:
  // the quote editor labels this input "Site address" and writes it to
  // customers.contact.address, so it IS the site address and the contract's
  // work clause is where it belongs.
  //
  // The customer row wins over the call because it was confirmed at send —
  // the contractor read it, corrected it if the model misheard it, and only
  // then did it go out on a quote. The SOW is the fallback for a job whose row
  // predates the editor's address field, or was sent without one.
  site_address:
    job?.customer?.contact?.address?.trim() ||
    job?.sow?.site_address?.trim() ||
    "",
  // Derived from the SAME captured field the quote and statement of work
  // render from, so the three documents cannot contradict each other. The
  // field stays editable; it just no longer starts empty next to a SoW that
  // already states the answer.
  materials_by: materialsResponsibility(job?.extracted_json?.materials_supply).by,
  materials_notes: materialsResponsibility(job?.extracted_json?.materials_supply).notes,
});

// ---------------------------------------------------------------------------
// The contract form's TIMING props, derived once for both surfaces.
//
// The job page passed a structured duration and the dashboard did not — it sent
// only a hint, because its query never selected sow_json. So the same form,
// reached two ways, started with different amounts of what the contractor had
// already said. That is the shape of defect this module exists to prevent, and
// it had it too.
//
// Start date is new here: labour_plan.working_dates is captured on most jobs
// ("WHEN the work is scheduled, in the contractor's own words") and was read by
// nothing, so every contract's start date opened empty and rendered as "To be
// confirmed".
// ---------------------------------------------------------------------------

export type ContractTiming = {
  initialDuration?: { value: string; unit: DurationUnit };
  durationHint?: string;
  initialStartDate?: string;
  startDateHint?: string;
};

export type ContractTimingJob = {
  sow_json?: unknown;
  extracted_json?: { timeline?: string } | null;
} | null;

// The three values this needs, read one at a time and defensively.
//
// Deliberately NOT sowStateSchema.safeParse. Running the whole SOW schema here
// would mean any unrelated violation anywhere in sow_json — an older shape, a
// field added since — silently drops the timing, which is the exact failure
// this function exists to end. Each field degrades on its own instead, and
// nothing here can throw on a contract form.
const readTiming = (sowJson: unknown) => {
  const sow = (typeof sowJson === "object" && sowJson !== null ? sowJson : {}) as Record<
    string,
    unknown
  >;
  const plan = (typeof sow.labour_plan === "object" && sow.labour_plan !== null
    ? sow.labour_plan
    : {}) as Record<string, unknown>;

  return {
    timeline: typeof sow.timeline === "string" ? sow.timeline : null,
    durationDays: typeof plan.duration_days === "number" ? plan.duration_days : null,
    workingDates: typeof plan.working_dates === "string" ? plan.working_dates : null,
  };
};

export const contractTimingFromJob = (job: ContractTimingJob): ContractTiming => {
  const { timeline, durationDays, workingDates } = readTiming(job?.sow_json);

  const initialDuration = durationFromDays(durationDays);
  const initialStartDate = startDateFromWorkingDates(workingDates) ?? undefined;

  return {
    initialDuration: initialDuration ?? undefined,
    // A hint only when there is no structured value to seed — never both.
    durationHint: initialDuration
      ? undefined
      : durationHintFromTimeline(timeline ?? job?.extracted_json?.timeline ?? ""),
    initialStartDate,
    startDateHint: initialStartDate ? undefined : startDateHintFromWorkingDates(workingDates),
  };
};

// ---------------------------------------------------------------------------

/**
 * What the contractor TYPED on the contract they are replacing, layered over
 * what the job can derive.
 *
 * Pass-13 SERIOUS 4. A re-issue came back with "What work are you doing?"
 * empty, along with exclusions, materials notes, access arrangements and
 * additional terms. Only the fields `contractPrefillFromJob` derives — the
 * addresses, the warranty period — survived, because those are computed from
 * the job every time and were never the contractor's words in the first place.
 *
 * The scope of works on a large job is minutes of typing, and losing it is the
 * difference between recovery being usable and merely possible. The contract it
 * came from is right there: `contracts.job_input_json` holds exactly the shape
 * the form submits.
 *
 * THE PREVIOUS CONTRACT WINS, field by field, and only where it actually said
 * something. An empty string in the old contract is not an answer and must not
 * blank a value the job derives — that would make a re-issue WORSE than a first
 * issue, which is the failure this exists to remove.
 *
 * Timing is deliberately excluded. `start_date`, `completion_date` and
 * `estimated_duration` are managed as structured inputs with their own seeded
 * props, and the form's own comment says never to accept a prose start or
 * completion from prefill. A replacement contract also usually needs new dates:
 * the old ones are the likeliest reason it is being re-issued at all.
 */
const CARRIED_OVER = [
  "scope_of_work",
  "exclusions",
  "materials_by",
  "materials_notes",
  "access_arrangements",
  "payment_schedule",
  "warranty_period",
  "building_regs_responsibility",
  "special_terms",
  "client_address",
  "client_phone",
  "site_address",
] as const;

export const withPreviousContractInput = <T extends Record<string, unknown>>(
  derived: T,
  previous: Record<string, unknown> | null | undefined,
): T => {
  if (!previous) return derived;

  const carried: Record<string, unknown> = {};
  for (const field of CARRIED_OVER) {
    const value = previous[field];
    if (typeof value === "string" && value.trim() !== "") carried[field] = value;
  }
  return { ...derived, ...carried };
};

/**
 * The contract whose typed input a re-issue should inherit — the most recently
 * SENT, whatever its status.
 *
 * Deliberately NOT `currentContract`, which prefers the live one. There is no
 * live contract when a re-issue is being drafted: the point of the exercise is
 * that the last one was withdrawn or declined, and that dead contract is
 * precisely the one carrying the words worth keeping.
 */
export const contractToInheritFrom = <
  T extends { sent_at?: string | null; job_input_json?: unknown },
>(
  contracts: T[],
): T | null => {
  if (contracts.length === 0) return null;
  return (
    [...contracts].sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""))[0] ?? null
  );
};
