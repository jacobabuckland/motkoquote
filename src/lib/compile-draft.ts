import type { DraftLineItem, LineItem, LinePerson } from "@/lib/schemas/job";
import { normalize } from "@/lib/rate-card-matching";
import { lineItemTotal } from "@/lib/quote-math";
import { hasUnpricedLabour, hasUnpricedNonLabour } from "@/lib/unpriced-flags";
import type { StatedPrice } from "@/lib/schemas/stated-price";

// The deterministic compiler that sits between the drafting LLM and the
// stored quote. The LLM proposes STRUCTURE (kinds, days, quantities,
// references); this turns each draft line into a priced LineItem, computing
// every amount from the contractor's own confirmed numbers. No figure the
// LLM produced is ever trusted as a price — labour and rate-card lines carry
// no LLM amounts at all, materials carry an estimate flagged as such, and
// provisional sums carry an editable suggestion.

export type CompileTeamMember = {
  id: string;
  name: string;
  role: string | null;
  day_rate: number | null;
};

export type CompileRateCard = {
  id: string;
  work_type: string;
  unit: string;
  rate_per_unit: number;
};

export type CompileKnownPrice = {
  description: string;
  unit: string | null;
  unit_price: number;
};

export type CompileContext = {
  day_rate: number | null;
  overtime_rate: number | null;
  // Whole-percent markup on contractor-supplied materials (e.g. 25 for 25%).
  markup_pct: number | null;
  team_members: CompileTeamMember[];
  rate_cards: CompileRateCard[];
  known_material_prices: CompileKnownPrice[];
  // How to label the contractor themselves in a crew breakdown.
  owner_label: string;
  // Whether this contractor has ANY priced history to ground an estimate in —
  // a confirmed material price, a rate card, or a past job retrieved for this
  // scope. False on a first run, which is the case D16 exists for.
  //
  // With no history the drafting model has no anchor of any kind, so a material
  // "estimate" is not an estimate at all: it is a number the model made up, and
  // it renders on a customer document as a real price with a soft note beside
  // it. This flag is what lets those lines come out as flagged TBC instead —
  // the same treatment labour has always had when no day rate resolves.
  //
  // REQUIRED, deliberately (TYPE-1). It was optional so existing callers kept
  // their behaviour, and absent meant "assume history" — the permissive branch.
  // That is how the guest funnel acquired PFIX-4's defect: `src/lib/guest/
  // quote.ts` never set the field, took the default, and printed model-invented
  // material prices with markup applied on a public unauthenticated surface.
  //
  // A guard whose default is the UNSAFE branch will keep finding new callers to
  // catch out, and no test can cover the caller nobody has written yet. Required
  // is the only form that makes forgetting it a compile error.
  has_pricing_history: boolean;
  // What the contractor actually SAID about the crew and the duration, as
  // recorded during intake — or null where nothing was said, and for the guest
  // funnel, which has no labour plan at all.
  //
  // The labour line is priced from the contractor's own day rates, so its
  // figure has always been theirs. Its DAY COUNT is the model's, and nothing
  // distinguished a duration the contractor stated from one the model filled in
  // for them: both came out `assumed: false`, `provenance: contractor`. On
  // voice run 05 `labour_plan` was null outright and the quote carried three
  // people at eight days each, at real rates, attributed to the contractor.
  //
  // This is the asymmetry D16 left open. A material with no price behind it
  // comes out flagged and unpriced; the largest line on most quotes did not.
  //
  // OPTIONAL, and deliberately the opposite shape to `has_pricing_history`.
  // That one had to be required because its absent form took the PERMISSIVE
  // branch — forget it and model-invented prices printed as real ones, which
  // is how the guest funnel acquired PFIX-4. Here absent takes the STRICT
  // branch: a caller that omits it gets its labour lines labelled as
  // assumptions, which is the conservative, visible outcome. The hazard is
  // inverted, so the reason for requiring it does not apply.
  //
  // That matters beyond style. Making it required broke seventeen context
  // literals across two FROZEN acceptance files, one of which another open
  // branch also edits — a collision `cross-branch-collisions` correctly
  // refuses, because a frozen contract cannot be reconciled by whoever merges
  // second. A safe default reaches the same guarantee without touching a
  // frozen file at all.
  labour_plan?: CompileLabourPlan | null;
};

// The subset of the recorded `labour_plan` the compiler needs. Narrower than
// SowState on purpose, so a caller with no statement of work can answer it.
export type CompileLabourPlan = {
  people_count: number | null;
  duration_days: number | null;
  crew_description?: string | null;
};

/**
 * Whether a labour line's days rest on something the contractor said.
 *
 * Two halves, and both have to hold:
 *
 *   * HOW LONG — `duration_days`. With no duration, every day on the line is
 *     the model's own. This is the whole of voice run 05.
 *   * WHO — `people_count`, or a `crew_description` in plain words. This only
 *     bites once the line carries more than one person: a single-person line is
 *     the contractor themselves and needs no statement. Where a crew was never
 *     described and the model produced one anyway, the split across those
 *     people is invented even though the total duration was stated — voice run
 *     01 billed an owner, a plasterer and a labourer for 13 person-days off a
 *     `crew_description` that never counted them.
 *
 * `working_dates` is deliberately NOT accepted as evidence of duration. It
 * records WHEN the work happens, not how long it takes, and the schema is
 * explicit that neither is ever inferred from the other — run 01's "four days"
 * was sitting in `working_dates` precisely because it is prose about
 * scheduling.
 */
export const crewDaysAreStated = (
  labourPlan: CompileLabourPlan | null | undefined,
  peopleOnLine: number,
): boolean => {
  // Absent and null are the same answer, and it is the safe one: nothing was
  // captured, so nothing supports the days.
  if (!labourPlan) return false;
  if (labourPlan.duration_days == null) return false;
  if (peopleOnLine <= 1) return true;
  return labourPlan.people_count != null || Boolean(labourPlan.crew_description?.trim());
};

// The editor-facing flag raised when the labour line's days are the model's
// rather than the contractor's. Its siblings are UNRESOLVED_RATE_FLAG (no day
// rate) and UNSOURCED_PRICE_FLAG (no supplier price); this one is separate
// because the fix is different again — the rate is right and the line is
// priced, it is the NUMBER OF DAYS that nobody has confirmed.
export const ASSUMED_CREW_DAYS_FLAG =
  "Check the days on the labour line: how long the job takes wasn't captured in the " +
  "call, so these days are an assumption. Confirm them before sending.";

export const hasAssumedCrewDaysFlag = (flags: string[] | null | undefined): boolean =>
  (flags ?? []).includes(ASSUMED_CREW_DAYS_FLAG);

// Shown on the line itself in the editor, alongside the "Est." chip. Contractor
// facing only — the customer document says "Estimated" and no more.
export const ASSUMED_CREW_DAYS_NOTE = "Days assumed — confirm how long the job takes";

// The capped case, which is a different fact and needs different words: the
// contractor DID say how long, and the draft asked for more than that.
export const CAPPED_CREW_DAYS_NOTE = "Days reduced to the plan you gave — check them";

export const cappedCrewDaysFlag = (ceilingDays: number, proposedDays: number): string =>
  `Labour days were reduced: the draft asked for ${proposedDays} person-days, and the plan ` +
  `you gave allows at most ${ceilingDays}. The line has been scaled back to ${ceilingDays}. ` +
  `Set the days per person before sending.`;

export const hasCappedCrewDaysFlag = (flags: string[] | null | undefined): boolean =>
  (flags ?? []).some((flag) => flag.startsWith("Labour days were reduced:"));

// A place where the compiler had to deviate from what the LLM proposed —
// surfaced to monitoring (a `pricing_mismatch` event) so a drift between the
// model's guess and the contractor's real numbers is visible, never silent.
export type PricingMismatch = {
  kind: DraftLineItem["kind"];
  description: string;
  reason: "unresolved_team_member" | "unresolved_rate_card" | "no_rate" | "known_price_divergence";
  llm_value: number | null;
  computed_value: number | null;
};

// The editor-facing flag raised when a line could not be priced because no
// rate was available. Exported as a constant (with the predicate below) so the
// send-time guard matches on identity rather than re-guessing the wording.
export const UNRESOLVED_RATE_FLAG =
  "Labour isn't priced: no day rate was found for this job. Add your day rate in " +
  "Business details, or set the price on the line, before sending.";

export const hasUnresolvedRateFlag = (flags: string[] | null | undefined): boolean =>
  (flags ?? []).includes(UNRESOLVED_RATE_FLAG);

// The editor-facing flag raised when a material or provisional line has no
// price behind it — nothing the contractor said, nothing they have ever
// confirmed, and no history to draw on. Its counterpart for labour is
// UNRESOLVED_RATE_FLAG above.
export const UNSOURCED_PRICE_FLAG =
  "Some materials aren't priced: this is your first quote, so there's no supplier " +
  "price on file to work from. Enter what you pay on each line before sending.";

export const hasUnsourcedPriceFlag = (flags: string[] | null | undefined): boolean =>
  (flags ?? []).includes(UNSOURCED_PRICE_FLAG);

// PFIX-3. A stated price that reached no line, and a stated price refused on a
// labour line, are both things the contractor has to SEE — silence is what made
// the over-match unexplainable.
export const UNATTACHED_STATED_PRICE_PREFIX = "Not on any line: ";

export const unattachedStatedPriceFlag = (amount: number, span: string): string =>
  `${UNATTACHED_STATED_PRICE_PREFIX}you said £${amount.toFixed(2)} — "${span}" — ` +
  `but it isn't on any line of this quote. Put it on the right line before sending.`;

export const LABOUR_LOCK_REFUSED_PREFIX = "Not applied to labour: ";

export const labourLockRefusedFlag = (amount: number, description: string): string =>
  `${LABOUR_LOCK_REFUSED_PREFIX}£${amount.toFixed(2)} wasn't applied to "${description}", ` +
  `because that line is priced from the crew and the days they work. Change the crew or ` +
  `the days, or add a separate line for it.`;

export type CompileResult = {
  lineItems: LineItem[];
  mismatches: PricingMismatch[];
  // Contractor/app-directed notes routed off every customer-facing surface —
  // surfaced only in the editor. NEVER rendered on a document.
  contractorFlags: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Attaches a customer-facing note to a line only when present — customer_note
// is optional and exactOptionalPropertyTypes forbids assigning undefined.
const withCustomerNote = <T extends LineItem>(item: T, note: string | undefined): T =>
  note ? { ...item, customer_note: note } : item;

const MISMATCH_THRESHOLD = 0.1;

// Resolve one crew reference (a team_members id, or "owner") to a priced,
// labelled person. Labels come from data — the LLM never gets to title a
// person (so an apprentice can't be printed as "Lead Plumber").
// A resolved crew member, plus whether a real rate was actually found for
// them. `day_rate: 0` is ambiguous on its own — it is what we fall back to when
// no rate exists AND a legitimate figure for deliberately unpaid time — so the
// caller needs to be told which of the two it is looking at.
type ResolvedPerson = { person: LinePerson; rateFound: boolean };

const resolvePerson = (
  ref: string,
  days: number,
  overtime: boolean,
  ctx: CompileContext,
  mismatches: PricingMismatch[],
  description: string,
): ResolvedPerson => {
  const standardOwner = ctx.day_rate;
  const overtimeRate = ctx.overtime_rate ?? ctx.day_rate;

  if (ref === "owner") {
    const rate = overtime ? overtimeRate : standardOwner;
    if (rate == null) {
      mismatches.push({
        kind: "labour",
        description,
        reason: "no_rate",
        llm_value: null,
        computed_value: null,
      });
    }
    return {
      person: { label: ctx.owner_label, days, day_rate: rate ?? 0 },
      rateFound: rate != null,
    };
  }

  const member = ctx.team_members.find((m) => m.id === ref);
  if (!member) {
    mismatches.push({
      kind: "labour",
      description,
      reason: "unresolved_team_member",
      llm_value: null,
      computed_value: null,
    });
    return {
      person: { label: "Team member", days, day_rate: standardOwner ?? 0 },
      // An unresolved team member falls back to the owner's rate. If there
      // isn't one either, this line has no price behind it — the mismatch
      // above names a different cause, but the outcome is the same absent
      // figure and it must not render as £0.00.
      rateFound: standardOwner != null,
    };
  }

  const memberStandard = member.day_rate ?? ctx.day_rate;
  const rate = overtime ? (ctx.overtime_rate ?? memberStandard) : memberStandard;
  if (rate == null) {
    mismatches.push({
      kind: "labour",
      description,
      reason: "no_rate",
      llm_value: null,
      computed_value: null,
    });
  }
  const label = member.role ? `${member.name} (${member.role})` : member.name;
  return { person: { label, days, day_rate: rate ?? 0 }, rateFound: rate != null };
};

// A ceiling is only worth enforcing when it is generous enough that an honest
// quote never meets it. 5% absorbs the rounding of a half-day here or there.
const CREW_DAY_CEILING_TOLERANCE = 1.05;

/**
 * Scale a crew back to the person-days the contractor described, or null when
 * there is nothing to scale back to and nothing to do.
 *
 * Returns null — meaning "leave it alone" — when the plan records no duration
 * or no head count, when the line has no priced days, or when the model is
 * already inside the ceiling. It NEVER scales a crew up: a contractor who
 * quotes fewer days than their plan allows has done so deliberately.
 */
export const capCrewDaysToStatedPlan = (
  people: LinePerson[],
  labourPlan: CompileLabourPlan | null | undefined,
): { people: LinePerson[]; ceilingDays: number; proposedDays: number } | null => {
  const duration = labourPlan?.duration_days ?? null;
  const headCount = labourPlan?.people_count ?? null;
  if (duration == null || headCount == null) return null;
  if (duration <= 0 || headCount <= 0) return null;

  const ceilingDays = duration * headCount;
  const proposedDays = people.reduce((sum, person) => sum + person.days, 0);
  if (proposedDays <= 0) return null;
  if (proposedDays <= ceilingDays * CREW_DAY_CEILING_TOLERANCE) return null;

  const factor = ceilingDays / proposedDays;
  return {
    people: people.map((person) => ({
      ...person,
      days: Math.round(person.days * factor * 100) / 100,
    })),
    ceilingDays,
    proposedDays,
  };
};

// All labour drafts collapse into a SINGLE labour line — one person-day pool
// for the job. Per person we take the MAXIMUM days claimed across labour
// drafts, never the sum: a second "Tiling – 1 day" labour line is a
// task-split re-count of days already inside the crew's total, not extra
// work, so it must not inflate the labour total (the observed double-count
// failure). Such task-split descriptions become sub-bullets (includes_tasks)
// instead. The LLM is instructed to emit one labour line with the crew's
// total days and put the task breakdown in includes_tasks; this merge is the
// safety net when it doesn't.
const compileLabour = (
  drafts: Extract<DraftLineItem, { kind: "labour" }>[],
  ctx: CompileContext,
  mismatches: PricingMismatch[],
): LineItem => {
  const overtime = drafts.some((d) => d.overtime);
  const primary = drafts[0]!;

  const poolDays = new Map<string, number>();
  for (const draft of drafts) {
    for (const person of draft.people) {
      poolDays.set(person.ref, Math.max(poolDays.get(person.ref) ?? 0, person.days));
    }
  }

  const tasks: string[] = [];
  for (const [i, draft] of drafts.entries()) {
    for (const task of draft.includes_tasks) tasks.push(task);
    // A second/third labour draft is a task-split line — fold its description
    // in as a sub-bullet rather than a priced day.
    if (i > 0 && draft.description.trim()) tasks.push(draft.description.trim());
  }
  const includesTasks = [...new Set(tasks)];

  const resolved = [...poolDays.entries()].map(([ref, days]) =>
    resolvePerson(ref, days, overtime, ctx, mismatches, primary.description),
  );
  const people = resolved.map((r) => r.person);
  // If any of the crew has no rate behind them, the line's amount is absent
  // rather than zero. Nothing about the computed figures changes here — this
  // only records what the compiler already concluded, so the document can say
  // "not priced" instead of printing a £0.00 a customer would read as free.
  const unpriced = resolved.some((r) => !r.rateFound);

  const totalDays = people.reduce((sum, p) => sum + p.days, 0);
  const crewTotal = people.reduce((sum, p) => sum + p.days * p.day_rate, 0);

  // A single customer-facing note for the merged labour line — join any the
  // model attached across the folded drafts.
  const customerNote = drafts
    .map((d) => d.customer_note?.trim())
    .filter((n): n is string => Boolean(n))
    .join(" ");

  // Whether the DAYS rest on something the contractor said. The rate is always
  // theirs; the day count is the model's unless intake captured a duration (and
  // a crew, once there is more than one person on the line).
  const daysStated = crewDaysAreStated(ctx.labour_plan, people.length);

  // THE MODEL MAY NOT BILL MORE DAYS THAN THE CONTRACTOR DESCRIBED.
  //
  // #762 labels days nobody stated. This is the other half, and it is the one
  // that costs real money: days the contractor DID state, which the model then
  // ignored. On voice run 11 the contractor said owner 3.5, Daniel 5, Liam 2 —
  // ten and a half person-days — and the quote billed ten days for each of the
  // three. £6,200 against £2,275, on a line that looked entirely sourced,
  // because a duration and a crew HAD been captured so nothing flagged.
  //
  // `labour_plan` records how long and how many, never the per-person split, so
  // the most that can be derived from it is a CEILING: everyone on site every
  // day. That over-counts a staggered crew, which is the point — a ceiling is a
  // guard, not a correction, and it must never pull an honest quote down.
  //
  // Exceeding it is capped rather than refused. The rate is real and the work is
  // real; what is wrong is the number of days, and a bounded figure the
  // contractor is told to check beats both an unbounded one and no figure at
  // all. Every person is scaled by the same factor, because the split is
  // exactly what the compiler does not know.
  const capped = capCrewDaysToStatedPlan(people, ctx.labour_plan);
  if (capped) {
    people.splice(0, people.length, ...capped.people);
  }

  const base: LineItem = {
    description: primary.description,
    category: "labour",
    quantity: totalDays > 0 ? totalDays : 1,
    unit: "day",
    // Denormalised blended rate for consumers that ignore `people`; the real
    // total comes from `people` via lineItemTotal.
    unit_price: totalDays > 0 ? round2(crewTotal / totalDays) : 0,
    multiplier: 1,
    people_count: 1,
    overtime,
    assumed: !daysStated || capped !== null,
    people,
    // Provenance is about the DAY COUNT, because that is the half the model
    // supplies. Where intake captured a duration the line is the contractor's
    // throughout — their rates, their days — and stays "contractor", including
    // when a rate is missing and the line comes out unpriced (provenance says
    // where the number comes from, not whether it landed).
    //
    // Where it did not, the days are the model's, and saying "contractor" is a
    // claim the contractor stated a duration they never stated. The AMOUNT is
    // deliberately left alone: unlike a material with no price behind it, a
    // labour line has a real rate and a defensible figure, so zeroing it would
    // replace a number worth checking with no number at all. It is labelled,
    // flagged to the editor, and left for the contractor to confirm.
    provenance: {
      source: daysStated && !capped ? ("contractor" as const) : ("system-generated" as const),
    },
    ...(capped
      ? { assumption_note: CAPPED_CREW_DAYS_NOTE }
      : daysStated
        ? {}
        : { assumption_note: ASSUMED_CREW_DAYS_NOTE }),
    ...(unpriced ? { unpriced: true } : {}),
  };
  const withTasks = includesTasks.length > 0 ? { ...base, includes_tasks: includesTasks } : base;
  return withCustomerNote(withTasks, customerNote || undefined);
};

const findKnownPrice = (description: string, ctx: CompileContext): CompileKnownPrice | undefined => {
  const desc = normalize(description);
  return ctx.known_material_prices.find((known) => {
    const knownNorm = normalize(known.description);
    return knownNorm.length > 0 && (desc.includes(knownNorm) || knownNorm.includes(desc));
  });
};

const compileMaterial = (
  draft: Extract<DraftLineItem, { kind: "material" }>,
  ctx: CompileContext,
  mismatches: PricingMismatch[],
): LineItem => {
  const common = {
    description: draft.description,
    category: "materials" as const,
    quantity: draft.quantity,
    unit: draft.unit,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    supplied_by: draft.supplied_by,
  };

  // Customer-supplied: no cost, just named on the quote so the scope is clear.
  if (draft.supplied_by === "customer") {
    return withCustomerNote(
      {
        ...common,
        unit_price: 0,
        assumed: false,
        assumption_note: "Supplied by the customer",
        // The zero is this app's rule, not a figure anyone gave us.
        provenance: { source: "system-generated" as const },
      },
      draft.customer_note,
    );
  }

  const estimate = (draft.estimated_unit_cost_pence ?? 0) / 100;
  const known = findKnownPrice(draft.description, ctx);

  if (known) {
    // A contractor-confirmed price always wins over the model's estimate. If
    // the two diverge materially, that's worth surfacing.
    if (estimate > 0 && Math.abs(known.unit_price - estimate) / estimate > MISMATCH_THRESHOLD) {
      mismatches.push({
        kind: "material",
        description: draft.description,
        reason: "known_price_divergence",
        llm_value: estimate,
        computed_value: known.unit_price,
      });
    }
    return withCustomerNote(
      {
        ...common,
        unit_price: known.unit_price,
        assumed: false,
        // A price this contractor has confirmed before.
        provenance: { source: "contractor" as const },
      },
      draft.customer_note,
    );
  }

  // D16 — no monetary invention, first run included. With no confirmed price
  // for this material and no priced history anywhere on the account, the
  // model's `estimated_unit_cost_pence` is not grounded in anything: it is a
  // plausible figure, which is precisely what must never reach a customer
  // document. The line comes out unpriced and flagged instead, exactly as
  // labour does when no day rate resolves.
  //
  // Note the asymmetry with labour, and that it is deliberate: labour goes
  // unpriced whenever the rate is missing, because there is exactly one right
  // answer and we do not have it. A material estimate on an ESTABLISHED account
  // is still an estimate worth showing — the contractor has confirmed prices we
  // can sanity-check it against, and it is marked assumed. It is only the
  // first run, with nothing to check against, where "estimate" means "invented".
  if (ctx.has_pricing_history === false) {
    mismatches.push({
      kind: "material",
      description: draft.description,
      reason: "no_rate",
      llm_value: estimate > 0 ? estimate : null,
      computed_value: null,
    });
    return withCustomerNote(
      {
        ...common,
        unit_price: 0,
        assumed: true,
        assumption_note: "Not priced — add what you pay for this",
        unpriced: true,
        // Refused rather than invented, and labelled as ours either way.
        provenance: { source: "system-generated" as const },
      },
      draft.customer_note,
    );
  }

  const markup = 1 + (ctx.markup_pct ?? 0) / 100;
  return withCustomerNote(
    {
      ...common,
      unit_price: round2(estimate * markup),
      assumed: true,
      assumption_note: "Estimated material cost — confirm against supplier price",
      // THE MODEL'S OWN NUMBER. On 46e3d510 four of these totalling £1,256
      // shipped in place of a stated £400, carrying no provenance at all, and
      // nothing downstream could tell them from a figure the contractor said.
      provenance: { source: "system-generated" as const },
    },
    draft.customer_note,
  );
};

const compileRateCard = (
  draft: Extract<DraftLineItem, { kind: "rate_card" }>,
  ctx: CompileContext,
  mismatches: PricingMismatch[],
): LineItem => {
  const card = ctx.rate_cards.find((c) => c.id === draft.rate_card_id);
  const common = {
    description: draft.description,
    category: "other" as const,
    quantity: draft.quantity,
    multiplier: 1,
    people_count: 1,
    overtime: false,
  };

  if (!card) {
    mismatches.push({
      kind: "rate_card",
      description: draft.description,
      reason: "unresolved_rate_card",
      llm_value: null,
      computed_value: null,
    });
    return withCustomerNote(
      {
        ...common,
        unit: "item",
        unit_price: 0,
        assumed: true,
        assumption_note: "Couldn't match a rate card — price this manually",
        provenance: { source: "system-generated" as const },
      },
      draft.customer_note,
    );
  }

  return withCustomerNote(
    {
      ...common,
      unit: card.unit,
      unit_price: card.rate_per_unit,
      assumed: false,
      rate_card_id: card.id,
      // The contractor's own rate card.
      provenance: { source: "contractor" as const },
    },
    draft.customer_note,
  );
};

// A provisional sum is the model's own suggested figure, so it is invented by
// definition. On an established account that is fine and useful — the
// contractor has a body of work to judge it against and the line is marked
// provisional and editable. On a first run there is nothing to judge it
// against, so D16 applies here exactly as it does to materials.
const compileProvisional = (
  draft: Extract<DraftLineItem, { kind: "provisional" }>,
  ctx: CompileContext,
): LineItem => {
  if (ctx.has_pricing_history === false) {
    return withCustomerNote(
      {
        description: draft.description,
        category: "other",
        quantity: 1,
        unit: "sum",
        unit_price: 0,
        multiplier: 1,
        people_count: 1,
        overtime: false,
        assumed: true,
        assumption_note: draft.reason,
        provisional: true,
        unpriced: true,
        provenance: { source: "system-generated" as const },
      },
      draft.customer_note,
    );
  }

  return withCustomerNote(
    {
      description: draft.description,
      category: "other",
      quantity: 1,
      unit: "sum",
      unit_price: round2(draft.suggested_amount_pence / 100),
      multiplier: 1,
      people_count: 1,
      overtime: false,
      assumed: true,
      assumption_note: draft.reason,
      provisional: true,
      // "invented by definition", per the note above this function.
      provenance: { source: "system-generated" as const },
    },
    draft.customer_note,
  );
};

/**
 * Match a draft line description against a stated price's extracted `item`.
 *
 * Normalizes and compares words, requiring at least 2 shared significant words
 * (or one string containing the other). This is the STRONG signal: the
 * extractor named a thing, and the line is that thing.
 */
const matchStatedPriceByItem = (
  description: string,
  statedPrices: StatedPrice[],
): StatedPrice | undefined => {
  if (!description || statedPrices.length === 0) return undefined;

  const descNorm = normalize(description);
  const descWords = descNorm.split(/\s+/).filter((w) => w.length >= 3);

  for (const price of statedPrices) {
    if (!price.item) continue;
    const itemNorm = normalize(price.item);

    // Exact match
    if (descNorm === itemNorm) return price;

    // One contains the other
    if (descNorm.includes(itemNorm) || itemNorm.includes(descNorm)) return price;

    // Shared significant words (at least 2)
    const itemWords = itemNorm.split(/\s+/).filter((w) => w.length >= 3);
    if (itemWords.length > 0 && descWords.length > 0) {
      const shared = descWords.filter((w) => itemWords.includes(w));
      if (shared.length >= 2) return price;
    }
  }

  return undefined;
};

/**
 * Every stated price whose transcript span shares a significant word with the
 * description — the WEAK signal, and on its own a bad one.
 *
 * The span is a whole spoken sentence, so one shared word of three characters
 * or more, with no stop-word removal, means almost nothing: "and" is three
 * characters. It is kept because the extractor's `item` is frequently wrong in
 * a way the span is not — "Labour will be six hundred pounds for two days"
 * extracts as the item "two days", which matches no line anyone would write,
 * while the span still plainly names the labour.
 *
 * So this returns CANDIDATES, and `resolveStatedPrices` decides whether any of
 * them may be believed. Nothing calls it directly.
 */
const spanCandidates = (
  description: string,
  statedPrices: StatedPrice[],
): StatedPrice[] => {
  if (!description) return [];

  const descWords = normalize(description)
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (descWords.length === 0) return [];

  return statedPrices.filter((price) => {
    if (!price.transcript_span) return false;
    const spanWords = normalize(price.transcript_span)
      .split(/\s+/)
      .filter((w) => w.length >= 3);
    return descWords.some((w) => spanWords.includes(w));
  });
};

/**
 * Decide, for a whole quote at once, which line each stated price belongs to.
 *
 * This used to be a per-line first-match scan that fell back to the transcript
 * span on ONE shared word. That is what produced the send-blocking defect:
 * from the single sentence "The consumer unit is five hundred and twenty
 * pounds", £520 attached to the consumer unit line by `item` AND to "Twin and
 * earth cable" by span — on the word "and" — for a subtotal of £1,640 from one
 * stated price. The reconciliation gate then reported a duplicate amount and
 * refused the send, leaving the contractor a quote they could not send and no
 * explanation of why.
 *
 * The fix is not a bigger threshold or a stop-word list; both are guesses that
 * need re-tuning forever, and neither can tell a real second mention from a
 * coincidence. It is to resolve the whole set at once and only believe a span
 * match that has no competition:
 *
 *   1. Item matches are taken first, and the price they claim is spent.
 *   2. A span match is believed only when the pairing is one-to-one — this
 *      line is the only unmatched line that span could mean, AND that span is
 *      the only one this line could have come from.
 *
 * Under (1) the cable never sees £520, because the consumer unit already
 * claimed it by name. Under (2) two lines that both weakly match one sentence
 * cancel each other out rather than both being priced. A price left over is
 * reported to the contractor by `unattachedStatedPriceFlag`, so refusing to
 * guess is visible rather than silent.
 */
const resolveStatedPrices = (
  descriptions: string[],
  statedPrices: StatedPrice[],
): Map<string, StatedPrice> => {
  const resolved = new Map<string, StatedPrice>();
  if (statedPrices.length === 0) return resolved;

  // Pass 1 — item matches, strongest signal, taken in line order.
  const claimed = new Set<StatedPrice>();
  const unmatched: string[] = [];
  for (const description of descriptions) {
    if (resolved.has(description)) continue;
    const byItem = matchStatedPriceByItem(description, statedPrices);
    if (byItem) {
      resolved.set(description, byItem);
      claimed.add(byItem);
    } else {
      unmatched.push(description);
    }
  }

  // Pass 2 — span matches, but only where the pairing is unambiguous.
  const candidates = new Map<string, StatedPrice[]>();
  const claimants = new Map<StatedPrice, number>();
  for (const description of unmatched) {
    const forLine = spanCandidates(description, statedPrices).filter(
      (price) => !claimed.has(price),
    );
    candidates.set(description, forLine);
    for (const price of forLine) {
      claimants.set(price, (claimants.get(price) ?? 0) + 1);
    }
  }

  for (const description of unmatched) {
    const forLine = candidates.get(description) ?? [];
    // Ambiguous in either direction: this line could have come from more than
    // one thing said, or more than one line could be the thing that was said.
    if (forLine.length !== 1) continue;
    if ((claimants.get(forLine[0]) ?? 0) !== 1) continue;
    resolved.set(description, forLine[0]);
  }

  return resolved;
};

/**
 * Apply a stated price to a line item, handling qualifiers.
 * Returns the line with locked amount applied, or null if the line should be suppressed.
 */
const applyStatedPrice = (
  item: LineItem,
  statedPrice: StatedPrice,
  quantity?: number,
): LineItem | null => {
  // already_paid and excluded suppress the line entirely
  if (statedPrice.qualifiers.already_paid || statedPrice.qualifiers.excluded) {
    return null;
  }

  // Convert amount from pence to pounds
  const amountPounds = statedPrice.amount / 100;

  // Attach transcript provenance
  const provenance = {
    source: "transcript" as const,
    transcript_span: statedPrice.transcript_span,
  };

  // A stated price ANSWERS the refusal that D16 made.
  //
  // `compileMaterial` zeroes a material on an account with no pricing history
  // and marks it `unpriced` with "Not priced — add what you pay for this",
  // because the model's estimate is invented. That is right up to the moment a
  // price the CONTRACTOR stated lands on the line — at which point the line has
  // a real figure from a real source, and carrying the refusal forward makes
  // the document deny a number it is printing.
  //
  // Left in place, the quote PDF renders "To be confirmed" over the
  // contractor's own £10.80, and the editor tells them to enter a supplier
  // price they gave out loud in the call. Both flags read off `unpriced`, so
  // clearing it here is what closes the loop from voice runs 01, 03 and 05:
  // the price is extracted, it reaches the line, and the line stops calling
  // itself unpriced.
  //
  // `assumption_note` goes with it — it is the prose beside `assumed`, and
  // `assumed` is being set false on the line below. Both are dropped rather
  // than set undefined, because `exactOptionalPropertyTypes` distinguishes the
  // two and the schema's absent form is the one that means "no note".
  const { unpriced: _unpriced, assumption_note: _assumptionNote, ...priced } = item;

  // Handle 'each' qualifier: stated price is per unit
  if (statedPrice.qualifiers.each) {
    const qty = quantity ?? item.quantity ?? 1;
    return {
      ...priced,
      unit_price: amountPounds,
      quantity: qty,
      assumed: false,
      provenance,
    };
  }

  // For non-'each' prices, the stated amount is the total
  // We apply it as unit_price with quantity 1
  return {
    ...priced,
    unit_price: amountPounds,
    quantity: 1,
    assumed: false,
    provenance,
  };
};

export const compileDraftToLineItems = (
  drafts: DraftLineItem[],
  ctx: CompileContext,
  jobFlags: string[] = [],
  statedPrices: StatedPrice[] = [],
): CompileResult => {
  const mismatches: PricingMismatch[] = [];
  const lineItems: LineItem[] = [];

  // WHAT THIS GATES, AND WHAT IT NO LONGER GATES.
  //
  // It gates PRICING BEHAVIOUR only: when extraction found stated prices, a
  // line matching none of them is zeroed and flagged unpriced rather than given
  // a plausible number. An empty array means a pre-PRICE-1 legacy draft or the
  // guest funnel, which has no transcript extraction — in both, materials with
  // estimated costs must keep pricing normally, so this stays as it was.
  //
  // It used to gate PROVENANCE too, and that was the defect. Every line got its
  // source attached only when extraction had already succeeded, so the one case
  // where the model is freest to invent — nothing extracted, nothing to check
  // against — was the exact case where nothing was labelled. Quote 46e3d510
  // carried four model-estimated material lines totalling £1,256, in place of a
  // stated £400, with no provenance on any of them; reconcileStatedPrice's
  // unsourced-line check also requires statedPrices to be non-empty, so it never
  // ran either. The invention guard switched itself off whenever invention was
  // most likely.
  //
  // Provenance is now attached by each compiler at the point the number is
  // chosen, where the true source is actually known — contractor rates and
  // confirmed prices are "contractor", the model's own estimates and suggested
  // sums are "system-generated", and applyStatedPrice sets "transcript". It no
  // longer depends on extraction having run.
  const provenanceChecksEnabled = statedPrices.length > 0;

  // Filter out superseded prices before matching, but keep already_paid/excluded
  // so they can be matched and then suppressed by applyStatedPrice
  const activePrices = statedPrices.filter((price) => price.superseded_by === null);

  // Track which stated prices have been matched (to detect fitted items)
  const matchedPrices = new Map<StatedPrice, LineItem[]>();

  // PFIX-3: prices that end up on no line, and prices refused on a labour line.
  // Both become contractor flags rather than vanishing.
  const appliedPrices = new Set<StatedPrice>();
  const labourRefusals: { price: StatedPrice; description: string }[] = [];

  const labourDrafts = drafts.filter(
    (d): d is Extract<DraftLineItem, { kind: "labour" }> => d.kind === "labour",
  );
  // Whether the labour line's days came out as the model's rather than the
  // contractor's. Read off the compiled line rather than recomputed, so the
  // flag below and the label on the line can never disagree about it.
  let labourDaysAssumed = false;
  let labourDaysCapped: { ceilingDays: number; proposedDays: number } | null = null;
  if (labourDrafts.length > 0) {
    const labourLine = compileLabour(labourDrafts, ctx, mismatches);
    // Which of the two the line carries decides which flag the contractor gets:
    // "nobody said how long" and "you said how long, and the draft wanted more"
    // need different words and different actions.
    labourDaysCapped = capCrewDaysToStatedPlan(
      labourDrafts.flatMap((d) => d.people).map((p) => ({ label: p.ref, days: p.days, day_rate: 0 })),
      ctx.labour_plan,
    );
    labourDaysAssumed = labourLine.assumed === true && labourDaysCapped === null;
    lineItems.push(labourLine);
  }

  for (const draft of drafts) {
    let item: LineItem | null = null;

    if (draft.kind === "material") item = compileMaterial(draft, ctx, mismatches);
    else if (draft.kind === "rate_card") item = compileRateCard(draft, ctx, mismatches);
    else if (draft.kind === "provisional") item = compileProvisional(draft, ctx);

    if (item) lineItems.push(item);
  }

  // Resolve every line against every stated price ONCE, with the whole set in
  // view. Matching per line as each was compiled could not see that two lines
  // were about to claim the same amount, which is precisely the defect.
  const resolution = resolveStatedPrices(
    lineItems.map((item) => item.description),
    activePrices,
  );
  for (const item of lineItems) {
    const price = resolution.get(item.description);
    if (!price) continue;
    if (!matchedPrices.has(price)) matchedPrices.set(price, []);
    matchedPrices.get(price)!.push(item);
  }

  // Apply stated prices to matched lines
  const finalLineItems: LineItem[] = [];
  const processedPrices = new Set<StatedPrice>();

  for (const item of lineItems) {
    const matchedPrice = resolution.get(item.description);

    if (!matchedPrice) {
      // No stated price match. When provenance checks are enabled, this is an
      // unsourced line — flag it as unpriced rather than giving it a plausible
      // number. When checks are disabled (guest funnel, legacy drafts), price
      // normally.
      if (provenanceChecksEnabled) {
        // Unsourced line: flag as unpriced, zero the amount
        finalLineItems.push({
          ...item,
          unit_price: 0,
          unpriced: true,
          // THE ONE DELIBERATE STRIP, and the only line that leaves this
          // function without provenance.
          //
          // Reached only when extraction DID find stated prices and this line
          // matched none of them. The line is refused — zeroed and flagged — and
          // absent provenance is what reconcileStatedPrice's unsourced-line
          // check looks for, so stripping it keeps that guard live.
          //
          // Left alone deliberately while attaching provenance everywhere else:
          // changing it would silence a money guard, and the reconciler is being
          // reworked in B2.1/B2.2 where that belongs. Until then the invariant
          // reads: every line carries provenance unless it was refused here.
          provenance: undefined,
        });
      } else {
        // Provenance checks disabled: price normally
        finalLineItems.push(item);
      }
      continue;
    }

    // Handle 'fitted' qualifier: if multiple lines match this price, merge them
    if (matchedPrice.qualifiers.fitted) {
      const matchingLines = matchedPrices.get(matchedPrice) ?? [];

      // Only process fitted items once (take the first matching line)
      if (processedPrices.has(matchedPrice)) {
        // Skip this line - it's part of a fitted item already processed
        continue;
      }
      processedPrices.add(matchedPrice);

      // For fitted items, we want ONE line at the stated price
      // Use the first matching line's description, or combine if sensible
      const baseItem = matchingLines[0] ?? item;

      // Get quantity from draft if available (for 'each' items)
      const draft = drafts.find((d) => normalize(d.description) === normalize(baseItem.description));
      const quantity = draft && "quantity" in draft ? draft.quantity : baseItem.quantity;

      const applied = applyStatedPrice(baseItem, matchedPrice, quantity);
      if (applied) {
        appliedPrices.add(matchedPrice);
        finalLineItems.push(applied);
      }
    } else {
      // PFIX-3: a stated price is NOT applied to a labour line that is priced
      // from a crew breakdown.
      //
      // `applyStatedPrice` sets unit_price and quantity but leaves `people`
      // intact, and `lineItemTotal` prefers the breakdown whenever it is
      // present — so the lock is inert on exactly the line kind it most often
      // targets, and inert silently. Measured both ways while fixing this: a
      // locked £520 on a two-day owner line charged £600 with rates set, and
      // £0 without, because the breakdown sums to nothing and still wins.
      // There is no version of "apply" that governs the total while the
      // breakdown stands.
      //
      // The only way to make it govern is to clear the crew, and the 3 Sep
      // decision forbids that: those per-person days and rates are what the
      // SoW captured, and a whole-job fixed price already has its own
      // mechanism in `pricing.fixed_amount`. A per-item lock has no business
      // destroying the crew.
      //
      // So refuse, keep the provenance — the transcript is still where this
      // line came from — and tell the contractor with a flag naming the amount
      // they stated. On a line with no rates that leaves them an unpriced
      // labour line and a flag, which blocks the send until they act. That is
      // the honest outcome; silently producing £0, or £600, is not.
      //
      // A labour line with NO breakdown is not an exception: nothing is being
      // overridden there, so the lock governs it as it governs any other line.
      if (item.category === "labour" && (item.people?.length ?? 0) > 0) {
        labourRefusals.push({ price: matchedPrice, description: item.description });
        finalLineItems.push({
          ...item,
          provenance: {
            source: "transcript",
            transcript_span: matchedPrice.transcript_span,
          },
        });
        continue;
      }

      // Not fitted: apply stated price normally
      const draft = drafts.find((d) => normalize(d.description) === normalize(item.description));
      const quantity = draft && "quantity" in draft ? draft.quantity : item.quantity;

      const applied = applyStatedPrice(item, matchedPrice, quantity);
      if (applied) {
        appliedPrices.add(matchedPrice);
        finalLineItems.push(applied);
      }
    }
  }

  // Route contractor-directed notes off every line and into the editor-only
  // flag list — prefix with the line description for context. Job-level flags
  // (people not in team_members, etc.) pass straight through.
  // PFIX-3: every stated price the contractor made that did not end up on a
  // line. A price suppressed on purpose is not a failure — `already_paid` and
  // `excluded` are answered by suppressing the line, which is applyStatedPrice
  // returning null, and that is correct behaviour rather than something to
  // report.
  const unattached = activePrices.filter(
    (price) =>
      !appliedPrices.has(price) &&
      !price.qualifiers.already_paid &&
      !price.qualifiers.excluded &&
      !labourRefusals.some((refusal) => refusal.price === price),
  );

  const contractorFlags = [
    ...unattached.map((price) =>
      unattachedStatedPriceFlag(price.amount / 100, price.transcript_span),
    ),
    ...labourRefusals.map((refusal) =>
      labourLockRefusedFlag(refusal.price.amount / 100, refusal.description),
    ),
    ...drafts
      .map((d) => {
        const flag = d.contractor_flag?.trim();
        return flag ? `${d.description}: ${flag}` : null;
      })
      .filter((f): f is string => Boolean(f)),
    ...jobFlags,
    // An unresolved rate has to reach the person who can fix it, one step
    // BEFORE the document does — they resolve it by entering a rate, which is
    // strictly better than sending a correctly-disclosed but incomplete quote.
    // This previously went only to track("pricing_mismatch"); a telemetry sink
    // cannot change anyone's behaviour, so the signal was computed and thrown
    // away. The track() call stays — telemetry is still wanted, it just was
    // never the delivery mechanism.
    // The predicate lives in unpriced-flags.ts so the recompute that runs on
    // every later edit cannot disagree with this one about what "unpriced"
    // means. Carrying these forward untouched is what left a fully priced £540
    // quote unsendable on 3 Sep.
    ...(hasUnpricedLabour(finalLineItems) ? [UNRESOLVED_RATE_FLAG] : []),
    // The materials/provisional counterpart (D16). Kept as a separate flag
    // rather than reusing the labour one, because the two need different
    // actions from the contractor: a missing day rate is fixed once in
    // Settings, a missing supplier price is entered per line. Telling someone
    // to add their day rate when the unpriced line is a bag of plaster sends
    // them to the wrong screen.
    ...(hasUnpricedNonLabour(finalLineItems) ? [UNSOURCED_PRICE_FLAG] : []),
    // The third of the family, and the one that had nowhere to go before: the
    // rate resolved and the line is priced, but the DAYS it is priced for are
    // the model's. That has to reach the contractor, because they are the only
    // person who knows the real answer and the document does not otherwise
    // distinguish those days from ones they gave.
    ...(labourDaysAssumed ? [ASSUMED_CREW_DAYS_FLAG] : []),
    // The capped case. Separate from the one above because the fix is
    // different: there is a plan, it was exceeded, and the contractor is the
    // only one who knows the real split.
    ...(labourDaysCapped
      ? [cappedCrewDaysFlag(labourDaysCapped.ceilingDays, labourDaysCapped.proposedDays)]
      : []),
  ];

  return { lineItems: finalLineItems, mismatches, contractorFlags };
};
