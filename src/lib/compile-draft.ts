import type { DraftLineItem, LineItem, LinePerson } from "@/lib/schemas/job";
import { normalize } from "@/lib/rate-card-matching";
import { lineItemTotal } from "@/lib/quote-math";
import { hasUnpricedLabour, hasUnpricedNonLabour } from "@/lib/unpriced-flags";
import type { StatedPrice } from "@/lib/schemas/stated-price";
import type { StatedQuantity } from "@/lib/voice/stated-quantities";

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
  // Work the statement of work recorded as OUT of this quote: the description
  // of every `assumptions_and_unknowns` entry whose treatment is "excluded" or
  // "provisional_sum".
  //
  // The drafting model emits an option the customer is still choosing between,
  // or work to be quoted separately, as an ordinary line — and with no price
  // behind it (there is none, because it is not in the quote) the line lands
  // `unpriced`. An unpriced line blocks the whole quote from being accepted,
  // so on voice run 16 three lines the contractor had explicitly kept OUT of
  // the price — Option A, Option B and the curtain track — made the quote
  // unacceptable, and run 20's cornice did the same.
  //
  // The treatment was captured correctly every time. It just never reached the
  // decision about whether the item is a payable line.
  //
  // OPTIONAL, and absent drops nothing — the behaviour before this existed. It
  // can only ever remove a line that carries no price, so no total can move.
  out_of_scope_notes?: string[] | null;
  // THE CONTRACTOR'S OWN WORDS, for asking whether they mentioned a material
  // at all. Assembled by the caller with `contractorSaid`, which drops the
  // assistant's half of the call.
  //
  // Scenario 303 of the 19 Sep tranche: the contractor named their plaster and
  // said "no other materials", and the draft carried "Scrim tape and general
  // consumables (corner beads, gauging water, sandpaper)" anyway. Jacob's
  // decision of 16 Sep already answers whether that line may exist -- it may
  // not, and the TENDENCIES road to it was closed then. This is the other
  // road: the drafting model's own invention, which no rule forbade.
  //
  // Nothing already here could tell that line from a real one. Since #839 an
  // unconfirmed material is unpriced whatever its origin, so the scrim line
  // and the plaster lines beside it are identical in every field the compiler
  // holds -- same `unpriced`, same `system-generated` provenance. What
  // separates them is not in the draft at all. It is whether the contractor
  // ever said the words.
  //
  // OPTIONAL, and absent drops nothing -- the behaviour before this existed,
  // the same shape as `out_of_scope_notes` above and for the same reason: a
  // caller that forgets it gets a line kept, never a line lost.
  contractor_said?: string | null;
};

// The subset of the recorded `labour_plan` the compiler needs. Narrower than
// SowState on purpose, so a caller with no statement of work can answer it.
export type CompileCrewMemberDays = { name: string; days: number };

export type CompileLabourPlan = {
  people_count: number | null;
  duration_days: number | null;
  crew_description?: string | null;
  // Days per person, where the contractor gave them that way. Optional for the
  // same reason `labour_plan` itself is: absent must be a state the type
  // allows, so no frozen fixture has to be widened to say "nobody said".
  crew_days?: CompileCrewMemberDays[] | null;
};

/**
 * Whether a per-person plan can be believed at all.
 *
 * NOBODY WORKS MORE DAYS THAN THE JOB LASTS. It is the one thing that must be
 * true of any honest crew plan, and it is what catches the way this capture
 * actually fails: intake writes HOURS into `crew_days` as though they were
 * days. Voice run 19's contractor described three evening shifts of about five
 * hours each and the plan came back
 *
 *   crew_days: me 15, Daniel 11, Liam 8     duration_days: 5
 *
 * — fifteen days of work inside a five-day job.
 *
 * That plan then SET the labour line (#772), which is worse than the ceiling it
 * replaced: the draft's own 15 person-days became 34, and the quote read £7,370
 * against a correct £1,437.82. The guard meant to stop the model over-billing
 * had been handed a worse number than the model's and preferred it.
 *
 * So an impossible plan disqualifies itself ENTIRELY rather than per person.
 * One person's days being hours is not a local error — it means the whole
 * capture confused the two units, and the remaining figures are no more
 * trustworthy than the one that gave it away. Falling back to the duration ×
 * head-count ceiling is the conservative answer, and the contractor is told.
 *
 * Silent when there is no duration to check against: absence is not evidence,
 * and the pre-#772 behaviour is the safe floor.
 */
export const crewDaysExceedTheJob = (
  labourPlan: CompileLabourPlan | null | undefined,
): boolean => {
  const duration = labourPlan?.duration_days ?? null;
  if (duration == null || duration <= 0) return false;

  const crew = labourPlan?.crew_days ?? [];
  if (crew.length === 0) return false;

  // The SUM against everyone-every-day, not each person against the duration.
  //
  // The per-person test was the first version of this and it was too strict.
  // Round 4's run 16 recorded `duration_days: 2` for a job the same script
  // later captured as 3, with a correct 2/3/1 split — so Daniel's 3 days
  // exceeded the recorded duration and a CORRECT plan would have been thrown
  // away. `duration_days` is captured no more reliably than `crew_days` is,
  // and a guard that assumes one of them is right will be wrong whenever it
  // picks the wrong one.
  //
  // The sum is the test that does not have to choose. `duration × head count`
  // is the ceiling this file already derives elsewhere — everyone on site
  // every day — and a plan whose total EXCEEDS it is impossible whichever
  // field is at fault. It separates the two cases cleanly:
  //
  //   run 16   6 person-days against 3 × 2 = 6    — allowed, exactly at it
  //   run 19  34 person-days against 3 × 5 = 15   — refused, twice over
  //
  // Head count comes from the plan's own list rather than `people_count`,
  // which was null in four of the five runs that mattered.
  const ceiling = duration * crew.length;
  const stated = crew.reduce((sum, member) => sum + member.days, 0);
  return stated > ceiling;
};

/** The per-person plan, with anything unusable dropped — or nothing, if it cannot be believed. */
export const statedCrewDays = (
  labourPlan: CompileLabourPlan | null | undefined,
): CompileCrewMemberDays[] => {
  if (crewDaysExceedTheJob(labourPlan)) return [];
  return (labourPlan?.crew_days ?? []).filter(
    (member) => member.days > 0 && member.name.trim().length > 0,
  );
};

// Named to the contractor, because the alternative is a labour line quietly
// priced from the ceiling while the plan they gave is ignored.
export const impossibleCrewDaysFlag = (
  labourPlan: CompileLabourPlan | null | undefined,
): string => {
  const duration = labourPlan?.duration_days ?? 0;
  const crew = labourPlan?.crew_days ?? [];
  const stated = crew.reduce((sum, member) => sum + member.days, 0);
  return (
    `The days recorded per person don't fit the job: ${stated} person-days across ${crew.length} ` +
    `people on a ${duration}-day job, which is more than everyone working every day. That usually ` +
    `means hours were recorded as days. The labour line has been priced without that plan — set the ` +
    `days per person before sending.`
  );
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
  // A per-person plan answers both halves at once and is the strongest form of
  // either: it says who, and it says how long each of them is there. It does
  // not depend on `duration_days`, which is how long the JOB runs — a fact
  // runs 18 and 20 both filled in wrongly, and neither wrongness says anything
  // about whether the days per person were stated.
  if (statedCrewDays(labourPlan).length > 0) return true;
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
// confirmed. Its counterpart for labour is UNRESOLVED_RATE_FLAG above.
//
// The wording used to open "this is your first quote", which was true while the
// refusal was gated on `has_pricing_history`. It is not the reason any more —
// an established contractor gets this for any material they have never priced —
// and a flag that misdescribes why is one a contractor learns to ignore.
export const UNSOURCED_PRICE_FLAG =
  "Some materials aren't priced: there's no confirmed price on file for them, so " +
  "nothing was guessed. Enter what you charge for each one before sending.";

export const hasUnsourcedPriceFlag = (flags: string[] | null | undefined): boolean =>
  (flags ?? []).includes(UNSOURCED_PRICE_FLAG);

// PFIX-3. A stated price that reached no line, and a stated price refused on a
// labour line, are both things the contractor has to SEE — silence is what made
// the over-match unexplainable.
export const UNATTACHED_STATED_PRICE_PREFIX = "Not on any line: ";

export const unattachedStatedPriceFlag = (amount: number, span: string): string =>
  `${UNATTACHED_STATED_PRICE_PREFIX}you said £${amount.toFixed(2)} — "${span}" — ` +
  `but it isn't on any line of this quote. Put it on the right line before sending.`;

export const CAPPED_LINE_PREFIX = "Capped: ";

/**
 * What a cap did, so the contractor can see the arithmetic and change it.
 *
 * The rate stops being visible on the line once a cap binds — the customer is
 * charged £120 for the equipment, not £45 of anything — so this is the only
 * place both figures survive together.
 */
export const cappedLineFlag = (description: string, uncapped: number, cap: number): string =>
  `${CAPPED_LINE_PREFIX}"${description}" comes to £${uncapped.toFixed(2)} at the rate you gave, ` +
  `and you said no more than £${cap.toFixed(2)} — so it is charged at £${cap.toFixed(2)}. ` +
  `Change the line if the cap should not apply here.`;

export const LABOUR_LOCK_REFUSED_PREFIX = "Not applied to labour: ";

export const labourLockRefusedFlag = (amount: number, description: string): string =>
  `${LABOUR_LOCK_REFUSED_PREFIX}£${amount.toFixed(2)} wasn't applied to "${description}", ` +
  `because that line is priced from the crew and the days they work. Change the crew or ` +
  `the days, or add a separate line for it.`;

/** Units that name no particular thing, so a spoken unit may govern the line. */
const GENERIC_UNIT = /^(?:item|items|unit|units|each|ea|no|nr|off)$/i;

/** Same thing counted, or a line whose unit declines to say. Never a conversion. */
const unitsAreCompatible = (lineUnit: string | undefined, statedUnit: string): boolean => {
  const line = (lineUnit ?? "").trim().toLowerCase().replace(/s$/, "");
  const stated = statedUnit.trim().toLowerCase().replace(/s$/, "");
  if (line.length === 0 || GENERIC_UNIT.test(line)) return true;
  return line === stated;
};

export const CUSTOMER_SUPPLIED_PRICED_PREFIX = "Priced but customer-supplied: ";

/**
 * A price refused because the material is the customer's to buy.
 *
 * Deliberately not silent. Zeroing the line is right -- `compileMaterial`
 * states that rule and the customer must not be charged for what they supply
 * -- but a zero on its own hides the more likely story, which is that the
 * OWNERSHIP was captured wrong. The contractor is the only one who knows
 * which, so the flag names both possibilities.
 */
export const customerSuppliedPricedFlag = (description: string, amount: number): string =>
  `${CUSTOMER_SUPPLIED_PRICED_PREFIX}you said £${amount.toFixed(2)} for "${description}", but it ` +
  `is recorded as supplied by the customer, so it stays at £0. If you are supplying it, change ` +
  `who supplies it on the line and the price will apply.`;

export const UNIT_MISMATCH_PREFIX = "Quantity not applied: ";

/**
 * A count refused because the line is measured in something else.
 *
 * Says both units and the arithmetic it did NOT do, because the contractor is
 * the only person who knows how many bags are in a pack.
 */
export const unitMismatchFlag = (
  description: string,
  stated: number,
  statedUnit: string,
  lineUnit: string,
): string =>
  `${UNIT_MISMATCH_PREFIX}you said ${stated} ${statedUnit}${stated === 1 ? "" : "s"} of ` +
  `"${description}", but that line is priced per ${lineUnit}. Set the quantity in ${lineUnit}s ` +
  `yourself — applying ${stated} to a ${lineUnit} rate would charge for ${stated} ${lineUnit}s.`;

/** A material estimate the contractor has not confirmed, carried as a suggestion. */
export interface UnconfirmedEstimate {
  description: string;
  unit: string;
  estimate: number;
}

export const UNCONFIRMED_ESTIMATE_PREFIX = "Not priced: ";

/**
 * The estimate we would have charged, offered rather than applied.
 *
 * The refusal itself is right -- a figure the model invented must not reach a
 * customer document -- but a bare "add what you pay" makes the contractor
 * source every material price from nothing, and a guard that costs that much
 * gets switched off. So the number survives, on the contractor-only channel,
 * clearly labelled as ours and clearly not charged.
 *
 * Says "we guessed", never "it costs": the whole defect is a plausible figure
 * being mistaken for a sourced one, and the wording is the last place that
 * distinction can be lost.
 */
export const unconfirmedEstimateFlag = (
  description: string,
  estimate: number,
  unit: string,
): string =>
  `${UNCONFIRMED_ESTIMATE_PREFIX}"${description}" is on the quote with no price, because ` +
  `nothing you have confirmed says what it costs. We would have guessed £${estimate.toFixed(2)} ` +
  `per ${unit} — that is our figure, not yours, so it is not charged. Enter what you charge.`;

export const STATED_QUANTITY_PREFIX = "Quantity from what you said: ";

/**
 * What a stated count changed, and the words that changed it.
 *
 * The count is the multiplier on the line total, so this moves money. It moves
 * it in the direction the contractor asked for — they said eight and were
 * being billed for one — but a silent multiplication by eight is not something
 * anyone should discover on the customer's copy.
 */
export const statedQuantityFlag = (
  description: string,
  from: number,
  to: number,
  span: string,
): string =>
  `${STATED_QUANTITY_PREFIX}"${description}" was drafted at ${from}, but you said ` +
  `"${span}" — it is now ${to}. Change it back on the line if that is wrong.`;

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

// Words that identify nothing on their own, so they cannot carry a match.
const SCOPE_NOISE = new Set([
  "the", "and", "for", "with", "from", "that", "this", "not", "yet", "has", "have",
  "been", "will", "are", "was", "were", "into", "onto", "over", "under", "after",
  "before", "plus", "vat", "any", "all", "each", "their", "them", "your", "its",
  "work", "works", "job", "jobs", "item", "items", "quote", "quoted", "price",
  "priced", "pricing", "cost", "costs", "customer", "client", "per", "and/or",
]);

/**
 * Crude singular/present stem, so "refitting" meets "refit" and "boards" meets
 * "board". Not linguistics — just enough that two people describing the same
 * work in different tenses are recognised as describing the same work.
 */
const stem = (word: string): string =>
  word
    .replace(/(?:ings?|ed|es|s)$/u, "")
    .replace(/(.)\1$/u, "$1");

const distinctiveStems = (text: string): Set<string> => {
  const stems = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/u)) {
    if (raw.length < 4) continue;
    if (SCOPE_NOISE.has(raw)) continue;
    const stemmed = stem(raw);
    if (stemmed.length >= 3) stems.add(stemmed);
  }
  return stems;
};

// THREE distinctive words in common, and the number is measured rather than
// chosen. At two, run 16's main labour line — "prep and skim 96 square metres
// of walls and patch 12 square metres of ceiling" — matched the note about
// Option A and Option B on "skim" and "ceiling", and dropping the labour line
// is the worst thing this could possibly do. The four lines it must catch all
// share four, or three in the case of the cornice ("refit", "existing",
// "cornice"), so three separates them with room to spare.
//
// Run 17's genuinely unpriced "waste removal and disposal of ceiling debris"
// shares only "ceiling" with an exclusion about finishing the ceiling, and it
// must keep blocking, because nobody has priced it.
const MIN_SHARED_SCOPE_STEMS = 3;

/**
 * Whether a line describes work the statement of work put outside this quote.
 *
 * Only ever consulted for a line with no price, so the worst a false positive
 * can do is drop a line that carries no figure — never move a total.
 */
export const describesOutOfScopeWork = (
  description: string,
  outOfScopeNotes: string[] | null | undefined,
): string | null => {
  const notes = (outOfScopeNotes ?? []).filter((note) => note.trim().length > 0);
  if (notes.length === 0) return null;

  const lineStems = distinctiveStems(description);
  if (lineStems.size === 0) return null;

  for (const note of notes) {
    const noteStems = distinctiveStems(note);
    let shared = 0;
    for (const stemmed of lineStems) {
      if (noteStems.has(stemmed)) shared += 1;
      if (shared >= MIN_SHARED_SCOPE_STEMS) return note;
    }
  }
  return null;
};

/**
 * Whether a line describes something the contractor actually said.
 *
 * ONE distinctive word in common is enough, and the threshold is low on
 * purpose. This decides whether a line SURVIVES, so a false negative loses
 * something real and a false positive loses nothing -- the line stays, which
 * is what happened before this existed.
 *
 * That asymmetry is also why it is a fair test. A material the contractor
 * raised is a material they named: they said plaster, or finish, or cable, or
 * tiles, and any one of those words carries the line. An invention shares
 * nothing -- scrim tape, corner beads, gauging water and sandpaper appear
 * nowhere in a call about skimming two walls. Checked against the one real
 * contractor transcript we hold (job 7a5bd06d): its finish line shares three
 * stems, a scrim line would share none.
 *
 * Reuses `distinctiveStems`, so "finishing" meets "finish" and "boards" meets
 * "board". Matching on exact words instead would drop a line whenever the
 * drafting model inflected a word the contractor said, which is most of them.
 */
export const describesSomethingSaid = (
  description: string,
  contractorSaid: string | null | undefined,
): boolean => {
  const said = (contractorSaid ?? "").trim();
  if (said.length === 0) return true;

  const lineStems = distinctiveStems(description);
  // A description with no distinctive word of its own cannot be tested, so it
  // is not judged. Keeping it is the same direction as everything else here.
  if (lineStems.size === 0) return true;

  const saidStems = distinctiveStems(said);
  if (saidStems.size === 0) return true;

  for (const stemmed of lineStems) {
    if (saidStems.has(stemmed)) return true;
  }
  return false;
};

export const UNREQUESTED_MATERIAL_PREFIX = "Not on the quote: ";

/**
 * A material line removed because nothing in the call named it.
 *
 * Says what it was and that WE added it, because the contractor's reaction
 * should be "no, I didn't ask for that" or "actually I do want that" -- and
 * only the second one needs them to do anything.
 */
export const unrequestedMaterialFlag = (description: string): string =>
  `${UNREQUESTED_MATERIAL_PREFIX}we drafted "${description}", but you did not mention it in the ` +
  `call and it has no price behind it, so it has been left off rather than sent to the customer ` +
  `as an open cost. Add it as a line if you do want to charge for it.`;

export const outOfScopeLineFlag = (description: string, note: string): string =>
  `Left off the quote: "${description}" — you said it is not in this price ` +
  `(${note}). It is still described in the scope of work, so the customer can see ` +
  `it was discussed. Add it as a line if you do want to charge for it.`;

/** What a contractor calls themselves when listing the crew. */
const OWNER_WORDS = new Set(["me", "myself", "i", "owner", "self", "meself"]);

const nameKey = (name: string): string => name.toLowerCase().replace(/[^a-z]/g, "");

/**
 * The name a person on the line answers to. Labels arrive as "Daniel
 * (Labourer)" from a team member's name and role, so the role is dropped: the
 * contractor said "Daniel".
 */
const personNameKey = (label: string): string => nameKey(label.split("(")[0] ?? label);

/**
 * Set each person's days from the per-person plan the contractor gave.
 *
 * The ceiling below is a BOUND, and a bound cannot fix a crew whose total is
 * right and whose split is wrong. Run 16's contractor said 2 / 3 / 1 — six
 * person-days — and the draft billed two days each. Six person-days either way,
 * so no ceiling could ever have caught it, and the owner at £250 and the
 * labourer at £150 are not interchangeable: £1,240 billed against £1,310.
 *
 * Assignment is ALL OR NOTHING. Every person on the line must match exactly one
 * named person in the plan, and every named person must be used — otherwise the
 * plan is describing a different crew from the one the line carries, and the
 * safe answer is to leave the line alone and let the ceiling bound it. A
 * partial assignment would mix two accounts of the crew and could produce a
 * total neither of them states.
 *
 * Returns null when there is nothing to do, including when the days already
 * agree — so the caller can treat a non-null result as "the numbers moved".
 */
export const applyStatedCrewDays = (
  people: LinePerson[],
  labourPlan: CompileLabourPlan | null | undefined,
  ownerLabel: string,
): { people: LinePerson[]; statedDays: number; proposedDays: number } | null => {
  const stated = statedCrewDays(labourPlan);
  if (stated.length === 0) return null;
  if (people.length === 0) return null;
  if (stated.length !== people.length) return null;

  const ownerKey = personNameKey(ownerLabel);
  const unused = stated.map((member) => ({ member, taken: false }));

  const assigned: LinePerson[] = [];
  for (const person of people) {
    const personKey = personNameKey(person.label);
    const isOwner = personKey === ownerKey;

    const match =
      unused.find((entry) => !entry.taken && nameKey(entry.member.name) === personKey) ??
      (isOwner
        ? unused.find((entry) => !entry.taken && OWNER_WORDS.has(nameKey(entry.member.name)))
        : undefined);

    if (!match) return null;
    match.taken = true;
    assigned.push({ ...person, days: match.member.days });
  }

  const proposedDays = people.reduce((sum, person) => sum + person.days, 0);
  const statedDays = assigned.reduce((sum, person) => sum + person.days, 0);
  // Already saying the same thing — nothing moved, so nothing to tell anyone.
  if (assigned.every((person, index) => person.days === people[index]?.days)) return null;

  return { people: assigned, statedDays, proposedDays };
};

// The line's days came from the contractor's own per-person plan rather than
// the model's reading of it. A different fact again from the capped case: here
// nothing was bounded, the numbers were replaced with the ones that were said.
export const STATED_CREW_DAYS_NOTE = "Days taken from the crew you described";

export const statedCrewDaysFlag = (statedDays: number, proposedDays: number): string =>
  `Labour days were set from the crew you described: the draft had ${proposedDays} person-days ` +
  `split differently from the ${statedDays} you gave. The people are on different rates, so the ` +
  `split changes the price — check the days per person before sending.`;

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
  // A per-person plan gives the person-days EXACTLY, so it is the ceiling and
  // a far tighter one than the product below — which assumes everybody is on
  // site every day, and therefore never fired on the staggered crews of runs
  // 18 and 20. It is still only a ceiling here: correcting the split is
  // applyStatedCrewDays' job, and it runs first.
  const stated = statedCrewDays(labourPlan);
  const ceilingDays =
    stated.length > 0
      ? stated.reduce((sum, member) => sum + member.days, 0)
      : (() => {
          const duration = labourPlan?.duration_days ?? null;
          const headCount = labourPlan?.people_count ?? null;
          if (duration == null || headCount == null) return null;
          if (duration <= 0 || headCount <= 0) return null;
          return duration * headCount;
        })();
  if (ceilingDays == null) return null;
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
  // all. Every person is scaled by the same factor when the split is not known.
  //
  // Where `crew_days` IS recorded the split is known, and correcting it comes
  // first: a ceiling can only stop a crew being too big, and run 16's crew was
  // exactly the right size and shared out wrong — 2/3/1 billed as two days
  // each, £1,240 against £1,310, a difference no bound could ever see.
  const restated = applyStatedCrewDays(people, ctx.labour_plan, ctx.owner_label);
  if (restated) {
    people.splice(0, people.length, ...restated.people);
  }

  const capped = capCrewDaysToStatedPlan(people, ctx.labour_plan);
  if (capped) {
    people.splice(0, people.length, ...capped.people);
  }

  // AFTER both, because both rewrite `people`. These two feed the line's
  // `quantity` and its denormalised `unit_price`, and computing them up front
  // left a capped line describing the crew it had before the cap — the money
  // came out right, since `lineItemTotal` reads `people`, while the day count
  // beside it did not.
  const totalDays = people.reduce((sum, p) => sum + p.days, 0);
  const crewTotal = people.reduce((sum, p) => sum + p.days * p.day_rate, 0);

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
    // A restated line is the one case where the compiler ends up MORE certain
    // than the draft it was given: every day on it was named by the contractor,
    // person by person. So it is not an estimate, even though the numbers moved
    // — the note and the flag carry that, not the "Est." chip.
    assumed: (!daysStated || capped !== null) && !restated,
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
      source:
        restated || (daysStated && !capped)
          ? ("contractor" as const)
          : ("system-generated" as const),
    },
    ...(restated
      ? { assumption_note: STATED_CREW_DAYS_NOTE }
      : capped
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
  unconfirmedEstimates: UnconfirmedEstimate[],
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

  // D16, WIDENED — no monetary invention, ever, on any account.
  //
  // With no confirmed price for this material and nothing the contractor said,
  // `estimated_unit_cost_pence` is not grounded in anything: it is a plausible
  // figure, which is precisely what must never reach a customer document. The
  // line comes out unpriced and flagged instead, exactly as labour does when no
  // day rate resolves.
  //
  // THIS USED TO BE GATED ON `has_pricing_history`, and the gate was wrong for
  // the reason `compileProvisional` sets out two functions down: it asks about
  // the ACCOUNT when the question is about the ITEM. `hasPricingHistory` is
  // satisfied by a rate card for something else entirely, or merely by the
  // contractor having produced one past quote — which may itself have been
  // full of invented estimates. Neither tells anyone what a bag of finish
  // costs. The stated rationale for the gate ("the contractor has confirmed
  // prices we can sanity-check it against") describes `known_material_prices`,
  // which is checked directly above this and wins outright when it hits.
  //
  // So an unconfirmed estimate is a SUGGESTION, not a payable line. It is
  // carried to the contractor by the flag below rather than charged, and the
  // moment a price is confirmed — a stated price from the call, or a figure
  // typed in the editor — the line prices normally. `applyStatedPrice` clears
  // `unpriced` for exactly that reason.
  //
  // `ctx.has_pricing_history` stays on the context: it is read elsewhere, and
  // a first run still differs from an established one in what the flag says.
  mismatches.push({
    kind: "material",
    description: draft.description,
    reason: "no_rate",
    llm_value: estimate > 0 ? estimate : null,
    computed_value: null,
  });
  if (estimate > 0) {
    // The estimate is not thrown away. Charging it is the defect; losing it is
    // a different one — a contractor who has to source every material price
    // from scratch turns the guard off. It goes to the contractor-only flag
    // channel, which no customer document renders, with the markup that WOULD
    // have been applied so the suggestion is the figure they are judging.
    unconfirmedEstimates.push({
      description: draft.description,
      unit: draft.unit,
      estimate: round2(estimate * (1 + (ctx.markup_pct ?? 0) / 100)),
    });
  }
  return withCustomerNote(
    {
      ...common,
      unit_price: 0,
      assumed: true,
      // "what you CHARGE", not "what you pay". Whatever is typed here is the
      // figure the customer is billed -- no markup is added to it, and
      // `rememberMaterialPrices` stores it as this contractor's confirmed price
      // for next time. The old wording asked for a cost and then charged it,
      // which hands the contractor's own margin to the customer. It was
      // first-run-only while D16 was gated; widening the gate would have made
      // it the instruction on every quote.
      assumption_note: "Not priced — add what you charge for this",
      unpriced: true,
      // Refused rather than invented, and labelled as ours either way.
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

// A PROVISIONAL SUM NEVER CARRIES THE MODEL'S OWN FIGURE.
//
// `suggested_amount_pence` is invented by definition — the model picked it. This
// used to be charged whenever `has_pricing_history` was true, on the reasoning
// that an established account gives the contractor something to judge it
// against. That reasoning does not survive contact with what a provisional sum
// is FOR. History is a record of what this contractor pays for PLASTER; it
// grounds nothing about skip hire, making good, or a bonding coat nobody
// mentioned. The gate asked about the account when the question is about the
// item.
//
// Two live quotes on 16 Sep, both for £250 of labour and nothing else:
//
//   job 43: bonding £36 + waste £50 the contractor never mentioned  -> £336
//   job 46: a finish price they had SAID they did not know, at £40  -> £320
//
// Both contractors had said there were no other charges. A line marked
// "provisional" is still a line in the subtotal, and a customer reading the
// quote sees a number, not a label.
//
// So the figure goes and the LINE STAYS, unpriced, carrying its reason. That is
// what a provisional sum is: a placeholder for something real whose price is not
// known yet. It also hands the line to the out-of-scope filter below, which only
// ever considers lines with no price — a priced invention was invisible to the
// one guard built to remove work the contractor excluded.
//
// A provisional line the contractor DID put a price on is unaffected: stated
// prices are applied after this, by the same path that prices every other line.
const compileProvisional = (
  draft: Extract<DraftLineItem, { kind: "provisional" }>,
  _ctx: CompileContext,
): LineItem => {
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
};

/**
 * Match a draft line description against a stated price's extracted `item`.
 *
 * Normalizes and compares words, requiring at least 2 shared significant words
 * (or one string containing the other). This is the STRONG signal: the
 * extractor named a thing, and the line is that thing.
 */
const describesItem = (description: string, item: string): boolean => {
  const descNorm = normalize(description);
  const itemNorm = normalize(item);
  if (!descNorm || !itemNorm) return false;

  // Exact match
  if (descNorm === itemNorm) return true;

  // One contains the other
  if (descNorm.includes(itemNorm) || itemNorm.includes(descNorm)) return true;

  // Shared significant words (at least 2)
  const descWords = descNorm.split(/\s+/).filter((w) => w.length >= 3);
  const itemWords = itemNorm.split(/\s+/).filter((w) => w.length >= 3);
  if (itemWords.length === 0 || descWords.length === 0) return false;
  return descWords.filter((w) => itemWords.includes(w)).length >= 2;
};

/**
 * An item-LESS per-unit price takes its name from the count it agrees with.
 *
 * "I need 8 bags of finish and a tub of primer. 8 at GBP 12 each."
 *
 * The contractor said the material in one breath and the rate in the next,
 * counting back to it rather than repeating the name. #837 stopped that bare
 * "8" becoming the item's name, correctly -- a wrong name attaches to nothing
 * and groups with nothing, which is strictly worse than none. But item-LESS
 * only ever had a meaning for SUPERSESSION, where the unattached branch adopts
 * an amount into the nearest group by proximity. It never had one for
 * ATTACHING TO A LINE: `matchStatedPriceByItem` skips a price with no item
 * outright, so the GBP 12 reached no line at all and the finish shipped at
 * GBP 0 -- GBP 96 short on the shape above, and worse than the GBP 84 the
 * 19 Sep report measured before #837 and #839 changed what happens around it.
 *
 * Grouping is not attachment. This is the half that was missing.
 *
 * The count is the link, and it is the contractor's own on both sides: the
 * price says eight, and a quantity they stated says eight bags of finish. So
 * the price is named "finish" and reaches its line through the ordinary
 * matcher, with nothing downstream needing to know a name was ever absent.
 *
 * Four conditions, each removing a way of being wrong:
 *
 *  1. NO ITEM ALREADY. A price that named something has its own road, and this
 *     must never redirect it.
 *  2. PER-UNIT with a count of its own. A lump sum has nothing to agree with.
 *  3. EXACTLY ONE stated quantity carries that count. Two materials counted
 *     eight is an ambiguity, and guessing between them is how a price lands on
 *     the wrong material.
 *  4. The count is greater than one. "1 at GBP 25" agrees with every material
 *     the contractor mentioned once, which is most of them, and says nothing.
 */
const adoptItemFromCount = (
  price: StatedPrice,
  statedQuantities: StatedQuantity[],
): StatedPrice => {
  if (price.item) return price;
  if (!price.qualifiers.each) return price;
  if (price.quantity == null || price.quantity <= 1) return price;

  const agreeing = statedQuantities.filter((q) => q.quantity === price.quantity);
  if (agreeing.length !== 1) return price;

  return { ...price, item: agreeing[0]!.item };
};

const matchStatedPriceByItem = (
  description: string,
  statedPrices: StatedPrice[],
): StatedPrice | undefined => {
  if (!description || statedPrices.length === 0) return undefined;

  for (const price of statedPrices) {
    if (!price.item) continue;
    if (describesItem(description, price.item)) return price;
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
/**
 * A line that CANNOT receive a stated price, so it must neither take one nor
 * block another line from taking it.
 *
 * Only labour priced from a crew breakdown: `applyStatedPrice` would set
 * `unit_price` while `lineItemTotal` goes on preferring the breakdown, so the
 * lock is inert there and PFIX-3 refuses it outright. See the long note at the
 * refusal itself.
 */
const canReceiveStatedPrice = (item: LineItem): boolean =>
  !(item.category === "labour" && (item.people?.length ?? 0) > 0);

const resolveStatedPrices = (
  lines: Array<Pick<LineItem, "description" | "category" | "people">>,
  statedPrices: StatedPrice[],
): Map<string, StatedPrice> => {
  const resolved = new Map<string, StatedPrice>();
  if (statedPrices.length === 0) return resolved;

  // Pass 1 — item matches, strongest signal.
  //
  // ONE STATED PRICE CHARGES ONE LINE. This took each description in line order
  // and gave it whichever price matched, recording the price in `claimed` and
  // never reading it back — so a price matching two descriptions priced both.
  // Two placeholder lines carrying the word "finish" were each charged
  // 18 × £11.50, and the quote subtotalled £414 for £207 of plaster (job
  // d2fa171f, 16 Sep).
  //
  // Pass 2 below has always refused exactly this, in both directions: a line
  // that could have come from several things said, and a thing said that could
  // be several lines. Pass 1 now answers to the same rule; it is the asymmetry
  // that was the defect, not the absence of a policy.
  //
  // REFUSED, not first-line-wins. "First" is the drafting model's ordering, so
  // taking it is a coin flip over which line gets the money. An ambiguous price
  // ends up attached to nothing, which raises "Not on any line: you said
  // £11.50 … put it on the right line before sending" — the contractor is the
  // only one who knows which line it was.
  const claimed = new Set<StatedPrice>();
  const unmatched: string[] = [];
  const byItemFor = new Map<string, StatedPrice>();
  const receivable = new Map<string, boolean>();
  const canTake = new Map<StatedPrice, number>();
  const cannotTake = new Map<StatedPrice, number>();
  for (const line of lines) {
    const description = line.description;
    if (resolved.has(description)) continue;
    const byItem = matchStatedPriceByItem(description, statedPrices);
    if (!byItem) {
      unmatched.push(description);
      continue;
    }
    const takes = canReceiveStatedPrice(line as LineItem);
    byItemFor.set(description, byItem);
    receivable.set(description, takes);
    const tally = takes ? canTake : cannotTake;
    tally.set(byItem, (tally.get(byItem) ?? 0) + 1);
  }

  // A LINE THAT CANNOT TAKE THE MONEY DOES NOT GET A VOTE ON WHO DOES.
  //
  // Contention is counted among lines that could actually be priced. Counting
  // every matching description instead cost £88 on an ordinary quote the day
  // this refusal shipped: the labour line's own description read "…prep and
  // skim walls in two bedrooms … includes surface preparation, APPLYING
  // FINISHING PLASTER, and making good…", so it matched the stated £11.00 for
  // finishing plaster, contested it, and both lines came away with nothing —
  // £965 against £1,053 (job 99e90b36, 16 Sep). That labour line could never
  // have been priced from it; PFIX-3 refuses a stated price on a crew
  // breakdown outright.
  //
  // A price matching ONLY such a line still resolves to it, so PFIX-3 still
  // fires and still tells the contractor. It just no longer does so at the
  // expense of the line that was meant to have the money.
  for (const [description, price] of byItemFor) {
    const contenders = receivable.get(description)
      ? (canTake.get(price) ?? 0)
      : // Labour keeps the price only when no priceable line wants it.
        (canTake.get(price) ?? 0) === 0
        ? (cannotTake.get(price) ?? 0)
        : 0;

    if (contenders !== 1) {
      unmatched.push(description);
      continue;
    }
    resolved.set(description, price);
    claimed.add(price);
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
    // THE COUNT THE CONTRACTOR SAID BEATS THE ONE THE MODEL DIDN'T.
    //
    // This took the count from the drafting model's line, and the model writes
    // the count into the DESCRIPTION and leaves `quantity` at 1: "Finishing
    // plaster – for skimming walls in two bedrooms (eight bags)", quantity 1.
    // So "eight bags at eleven pounds a bag" charged £11 against £88 stated —
    // four of five voice runs on 16 Sep, undercharging every time.
    //
    // The stated count goes FIRST, ahead of the `quantity` argument. Both call
    // sites compute that argument as `draft.quantity ?? item.quantity`, which
    // is always a number and is the MODEL'S number — there is no human-typed
    // count arriving here to defer to. Ordering it after `quantity` leaves the
    // stated count permanently unreachable, which is what the first version of
    // this fix did: green tests, no behaviour change, the £11 still charged.
    const qty = statedPrice.quantity ?? quantity ?? item.quantity ?? 1;
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

/**
 * A CUSTOMER-SUPPLIED MATERIAL CONTRIBUTES NOTHING, AFTER EVERY PRICING STEP.
 *
 * `compileMaterial` already zeroes these -- the customer is not charged for
 * what the customer buys -- and then `applyStatedPrice` set a unit price
 * without re-reading `supplied_by`, so the rule held until the moment a stated
 * price arrived and silently stopped holding. Scenario 41 on 19 Sep shipped
 * both of its payable materials marked customer-supplied.
 *
 * Scoped to MATERIALS on purpose. Labour to fit a customer's own tiles is the
 * contractor's to charge, and a stated price for that work is theirs to state.
 */
const refusedForOwnership = (
  item: LineItem,
  price: StatedPrice,
  refusals: { price: StatedPrice; description: string }[],
): boolean => {
  if (item.category !== "materials" || item.supplied_by !== "customer") return false;
  // A suppressed price is not a refusal: already-paid and excluded remove the
  // line outright, which applyStatedPrice handles and which is not a charge.
  if (price.qualifiers.already_paid || price.qualifiers.excluded) return false;
  refusals.push({ price, description: item.description });
  return true;
};

export const compileDraftToLineItems = (
  drafts: DraftLineItem[],
  ctx: CompileContext,
  jobFlags: string[] = [],
  statedPrices: StatedPrice[] = [],
  statedQuantities: StatedQuantity[] = [],
): CompileResult => {
  const mismatches: PricingMismatch[] = [];
  const unconfirmedEstimates: UnconfirmedEstimate[] = [];
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
  const liveStatedPrices = statedPrices.filter((price) => price.superseded_by === null);

  // A CAP IS A CEILING, NOT A PRICE, so it never competes to be one.
  //
  // "The equipment's £45 a shift, but capped it at £120 for the job" states two
  // real figures. Both used to arrive here as ordinary prices: £45 landed on
  // the equipment line and £120 landed nowhere, so the job undercharged by £75
  // and said so in a flag nobody had to read. Held back from matching and
  // applied after pricing, below.
  const capPrices = liveStatedPrices.filter((price) => price.caps_item != null);
  const activePrices = liveStatedPrices
    .filter((price) => price.caps_item == null)
    .map((price) => adoptItemFromCount(price, statedQuantities));

  // Track which stated prices have been matched (to detect fitted items)
  const matchedPrices = new Map<StatedPrice, LineItem[]>();

  // PFIX-3: prices that end up on no line, and prices refused on a labour line.
  // Both become contractor flags rather than vanishing.
  const appliedPrices = new Set<StatedPrice>();
  // Lines whose COUNT a stated price settled, as opposed to lines a stated
  // price merely put a rate on. See the stated-quantity guard's condition 3.
  const countSettledByPrice = new Set<string>();
  const labourRefusals: { price: StatedPrice; description: string }[] = [];
  const ownershipRefusals: { price: StatedPrice; description: string }[] = [];

  const labourDrafts = drafts.filter(
    (d): d is Extract<DraftLineItem, { kind: "labour" }> => d.kind === "labour",
  );
  // Whether the labour line's days came out as the model's rather than the
  // contractor's. Read off the compiled line rather than recomputed, so the
  // flag below and the label on the line can never disagree about it.
  let labourDaysAssumed = false;
  let labourDaysCapped: { ceilingDays: number; proposedDays: number } | null = null;
  let labourDaysRestated: { statedDays: number; proposedDays: number } | null = null;
  // A per-person plan that cannot be true is not used, and not passed over in
  // silence either: the contractor gave one and the quote is not priced from it.
  const crewDaysImpossible = labourDrafts.length > 0 && crewDaysExceedTheJob(ctx.labour_plan);
  if (labourDrafts.length > 0) {
    const labourLine = compileLabour(labourDrafts, ctx, mismatches);
    // Which of the three the line carries decides which flag the contractor
    // gets: "nobody said how long", "you said how long and the draft wanted
    // more", and "you said who does which days and the draft split them
    // differently" need different words and different actions.
    //
    // Restating is read off the compiled line rather than recomputed, because
    // matching a crew by name needs the RESOLVED labels — "Daniel (Labourer)"
    // — and only compileLabour has them. The cap below can be recomputed from
    // the refs because it needs nothing but days.
    const wasRestated = labourLine.assumption_note === STATED_CREW_DAYS_NOTE;
    const draftPersonDays = labourDrafts
      .flatMap((d) => d.people)
      .reduce((sum, p) => sum + p.days, 0);

    if (wasRestated) {
      labourDaysRestated = {
        statedDays: (labourLine.people ?? []).reduce((sum, p) => sum + p.days, 0),
        proposedDays: draftPersonDays,
      };
    }

    // A restated line already carries the contractor's own person-days, so
    // there is nothing left for the ceiling to bound — and recomputing it from
    // the draft's days would report a cap that never happened.
    labourDaysCapped = wasRestated
      ? null
      : capCrewDaysToStatedPlan(
          labourDrafts
            .flatMap((d) => d.people)
            .map((p) => ({ label: p.ref, days: p.days, day_rate: 0 })),
          ctx.labour_plan,
        );
    labourDaysAssumed = labourLine.assumed === true && labourDaysCapped === null;
    lineItems.push(labourLine);
  }

  for (const draft of drafts) {
    let item: LineItem | null = null;

    if (draft.kind === "material")
      item = compileMaterial(draft, ctx, mismatches, unconfirmedEstimates);
    else if (draft.kind === "rate_card") item = compileRateCard(draft, ctx, mismatches);
    else if (draft.kind === "provisional") item = compileProvisional(draft, ctx);

    if (item) lineItems.push(item);
  }

  // Resolve every line against every stated price ONCE, with the whole set in
  // view. Matching per line as each was compiled could not see that two lines
  // were about to claim the same amount, which is precisely the defect.
  const resolution = resolveStatedPrices(lineItems, activePrices);
  for (const item of lineItems) {
    const price = resolution.get(item.description);
    if (!price) continue;
    if (!matchedPrices.has(price)) matchedPrices.set(price, []);
    matchedPrices.get(price)!.push(item);
  }

  // Apply stated prices to matched lines
  let finalLineItems: LineItem[] = [];
  const processedPrices = new Set<StatedPrice>();

  for (const item of lineItems) {
    const matchedPrice = resolution.get(item.description);

    if (!matchedPrice) {
      // No stated price match. When provenance checks are enabled, this is an
      // unsourced line — flag it as unpriced rather than giving it a plausible
      // number. When checks are disabled (guest funnel, legacy drafts), price
      // normally.
      if (provenanceChecksEnabled) {
        // VOICE-U1: A labour line priced from the contractor's own rates is not
        // "unsourced". Lines with provenance.source === "contractor" already carry
        // confirmed pricing from the contractor's own data (stored rates, rate
        // cards, known material prices), so they are never zeroed or marked
        // unpriced, even when they match no stated price.
        //
        // Additionally, LABOUR lines not already marked unpriced (those with real
        // rates) have a defensible figure even if the days are system-generated.
        // Unlike a material with no price behind it, a labour line with rates
        // should not be zeroed — that would replace a number worth checking with no
        // number at all (see lines 659-663 for this rationale).
        if (item.provenance?.source === "contractor" || (item.category === "labour" && item.unpriced !== true)) {
          // Contractor-sourced OR labour with rates (defensible figure): pass through
          finalLineItems.push(item);
        } else {
          // Genuinely unsourced line: flag as unpriced, zero the amount
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
        }
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

      if (refusedForOwnership(baseItem, matchedPrice, ownershipRefusals)) {
        finalLineItems.push(baseItem);
        continue;
      }

      const applied = applyStatedPrice(baseItem, matchedPrice, quantity);
      if (applied) {
        appliedPrices.add(matchedPrice);
        if (matchedPrice.quantity != null) countSettledByPrice.add(applied.description);
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

      if (refusedForOwnership(item, matchedPrice, ownershipRefusals)) {
        finalLineItems.push(item);
        continue;
      }

      const applied = applyStatedPrice(item, matchedPrice, quantity);
      if (applied) {
        appliedPrices.add(matchedPrice);
        if (matchedPrice.quantity != null) countSettledByPrice.add(applied.description);
        finalLineItems.push(applied);
      }
    }
  }

  // THE LESSER OF RATE x COUNT AND THE CAP. Jacob's call, 16 Sep.
  //
  // Applied after pricing because a cap can only be compared against a total
  // that exists. Where it does not bind — three shifts at £45 against a £250
  // cap — nothing happens and the metered line stands, which is the common
  // case and the one worth protecting.
  //
  // Where it does bind, the line becomes the capped amount charged once. The
  // rate stops being visible on the document, and that is the honest reading:
  // the customer is being charged £120 for the equipment, not £45 of anything.
  // The rate and the cap both survive in the flag, which is where the
  // contractor can see the arithmetic and change it.
  const cappedLines: Array<{ description: string; uncapped: number; cap: number }> = [];
  for (const cap of capPrices) {
    const capAmount = cap.amount / 100;
    // Matched on what the cap QUALIFIES, not on its own item name — the cap's
    // own `item` is whatever words trailed it ("job", "no more than") and names
    // nothing. Reuses the ordinary matcher by asking it about the target.
    const asTarget: StatedPrice = { ...cap, item: cap.caps_item ?? null };
    const target = finalLineItems.find(
      (line) => matchStatedPriceByItem(line.description, [asTarget]) != null,
    );
    if (!target) continue;

    const uncapped = lineItemTotal(target);
    if (uncapped <= capAmount) continue;

    cappedLines.push({ description: target.description, uncapped, cap: capAmount });
    const index = finalLineItems.indexOf(target);
    finalLineItems[index] = {
      ...target,
      quantity: 1,
      unit_price: capAmount,
      multiplier: 1,
      people_count: 1,
      provenance: { source: "transcript", transcript_span: cap.transcript_span },
    };
  }

  // WORK THE CONTRACTOR KEPT OUT OF THE PRICE IS NOT A PAYABLE LINE.
  //
  // An option the customer is still choosing between, or work to be quoted
  // separately, arrives from the drafting model as an ordinary line. There is
  // no price behind it — there is none to have — so it lands `unpriced`, and
  // an unpriced line stops the quote being accepted at all. Run 16 carried
  // three of them and run 20 one, so in both cases the quote was unacceptable
  // because of work explicitly NOT in it.
  //
  // Two conditions keep this safe. Only an UNPRICED line is eligible, so no
  // total can move whatever this decides; and a labour line is never eligible,
  // because the labour line is the job itself and an option never is. That
  // second one is not hypothetical: at a two-word threshold run 16's own
  // labour line matched the note about Option A and Option B on "skim" and
  // "ceiling".
  const outOfScope: Array<{ description: string; note: string }> = [];
  const inScopeLineItems = finalLineItems.filter((item) => {
    if (item.unpriced !== true) return true;
    if (item.category === "labour") return true;
    const note = describesOutOfScopeWork(item.description, ctx.out_of_scope_notes);
    if (note === null) return true;
    outOfScope.push({ description: item.description, note });
    return false;
  });
  finalLineItems.splice(0, finalLineItems.length, ...inScopeLineItems);

  // A MATERIAL NOBODY ASKED FOR IS NOT A LINE ON THE CUSTOMER'S QUOTE.
  //
  // Jacob decided this on 16 Sep -- the drafting model may not add lines the
  // contractor never mentioned -- and the tendencies road was closed then:
  // "past jobs have included a PVA bonding agent line, not added here" is a
  // FLAG on scenario 303, working exactly as decided. The scrim tape beside it
  // is the road left open, because the model does not need a tendency to
  // invent a line. Nothing in the drafting prompt forbids it, and the quote
  // carried GBP 60 of it against an explicit "no other materials".
  //
  // #839 took the money out of it -- the line is unpriced now, so no total
  // moves either way. What it did not do is take the line off the document:
  // it still reaches the customer as "To be confirmed", which reads as an open
  // cost for work that is not in the job, and it still blocks the send until
  // the contractor prices or deletes something they never wanted. So the
  // remaining harm is real and this is what is left of it.
  //
  // The same two conditions that keep the out-of-scope filter safe hold here,
  // and they are the reason this may act on its own judgement at all: only an
  // UNPRICED line is eligible, so nothing it decides can move a total; and a
  // labour line is never eligible, because the labour line is the job. A third
  // is added -- the line must be `system-generated`, so a material carrying a
  // price the contractor stated or confirmed is out of reach by construction.
  //
  // Nothing is deleted quietly: every line removed is named in a flag.
  const unrequested: string[] = [];
  const requestedLineItems = finalLineItems.filter((item) => {
    if (item.unpriced !== true) return true;
    if (item.category !== "materials") return true;
    if (item.provenance?.source !== "system-generated") return true;
    if (describesSomethingSaid(item.description, ctx.contractor_said)) return true;
    unrequested.push(item.description);
    return false;
  });
  finalLineItems.splice(0, finalLineItems.length, ...requestedLineItems);

  // Route contractor-directed notes off every line and into the editor-only
  // flag list — prefix with the line description for context. Job-level flags
  // (people not in team_members, etc.) pass straight through.
  // PFIX-3: every stated price the contractor made that did not end up on a
  // line. A price suppressed on purpose is not a failure — `already_paid` and
  // `excluded` are answered by suppressing the line, which is applyStatedPrice
  // returning null, and that is correct behaviour rather than something to
  // report.
  // A COUNT IN ONE UNIT MAY NOT MULTIPLY A LINE PRICED IN ANOTHER.
  //
  // Reproduced against the deployed compiler on 19 Sep: the contractor says
  // "8 bags of finish", the drafted line is priced per PACK at GBP 48, and
  // this guard wrote 8 PACKS -- GBP 384 against a correct GBP 96, a fourfold
  // OVERCHARGE on a customer-facing document. A pack is four bags; eight bags
  // is two packs; and nothing here knows that, because no conversion between
  // trade units exists or should be invented.
  //
  // So the rule is compatibility, not conversion: the count applies when the
  // line is measured in the same thing the contractor counted, and otherwise
  // the line is left exactly as drafted and the mismatch is said out loud for
  // a human to settle. A generic unit ("item", "unit", "each") is the model
  // declining to name one, so a real spoken unit governs it -- but a CONTAINER
  // ("pack", "box", "roll", "lot", "set") has a cardinality of its own, and
  // that is precisely the case this exists to refuse.
  // THE COUNT THE CONTRACTOR SAID, WHERE NO PRICE CARRIED IT.
  //
  // `applyStatedPrice` already does this for a count stated beside a per-unit
  // price. A count stated on its own — "I need eight bags of finish" — reached
  // here as nothing at all, because the price extractor had no price to hang it
  // on, and the drafting model writes such a count into the DESCRIPTION and
  // leaves `quantity` at 1. Same undercharge, other road.
  //
  // FOUR CONDITIONS, all required, and each one is a way this could go wrong:
  //
  //  1. MATERIAL LINES ONLY. A count of bags has no business multiplying
  //     labour, a rate-card line or a provisional sum.
  //  2. THE LINE MUST STILL BE AT 1. One is the model's "didn't bother"
  //     value; any other number is a real answer from the draft and outranks
  //     an inference made here.
  //  3. THE LINE'S COUNT MUST NOT ALREADY BE SETTLED BY A STATED PRICE. Where
  //     one is, it has more evidence than this does and two writers on one
  //     number is how they come to disagree.
  //
  //     This used to read "not already priced from the transcript", and that
  //     is a different claim. A price settles a line's COUNT only when it
  //     carried one: "eight bags at GBP 12 each" does, and "finish is twelve
  //     pounds a bag" does not -- it settles the RATE and says nothing about
  //     how many. So a contractor speaking the ordinary way,
  //
  //       "Eight bags of finish and one tub of primer.
  //        Finish is twelve pounds a bag, primer is twenty five pounds."
  //
  //     had the count read, the rate read, the rate applied -- and the count
  //     refused, on the grounds that the rate had settled it. The line stayed
  //     at one bag: GBP 37 against GBP 121, the GBP 84 scenario 41 shipped
  //     short. Both name-readers were clean on that sentence; the identity
  //     leak the report suspected was not what cost the money.
  //
  //     Nothing is lost by narrowing it, because condition 2 already covers
  //     the case this was reaching for: a price carrying a count of eight
  //     leaves the line AT eight, so the line is no longer at 1 and the guard
  //     has already stood down. The two readers also never read one sentence
  //     -- `extractStatedQuantities` skips any sentence stating money -- so
  //     the disagreement it feared needs the two halves said separately, which
  //     is exactly when only one of them has an answer.
  //  4. EXACTLY ONE LINE MAY MATCH. A count matching two lines names neither
  //     — the same ambiguity rule #793 applies to prices, for the same reason:
  //     attaching it to the first is a coin toss with the customer's money.
  const quantityCorrections: { description: string; from: number; to: number; span: string }[] = [];
  const unitMismatches: { description: string; stated: number; statedUnit: string; lineUnit: string }[] = [];
  const withStatedQuantities = ((): LineItem[] => {
    if (statedQuantities.length === 0) return finalLineItems;

    const takers = new Map<string, StatedQuantity>();
    for (const stated of statedQuantities) {
      const matches = finalLineItems.filter(
        (line) =>
          line.category === "materials" &&
          line.quantity === 1 &&
          !countSettledByPrice.has(line.description) &&
          describesItem(line.description, stated.item),
      );
      if (matches.length !== 1) continue;
      const only = matches[0]!;
      // Same thing counted, or nothing doing. See above: a pack is not a bag.
      if (!unitsAreCompatible(only.unit, stated.unit)) {
        unitMismatches.push({
          description: only.description,
          stated: stated.quantity,
          statedUnit: stated.unit,
          lineUnit: (only.unit ?? "unit").replace(/s$/, ""),
        });
        continue;
      }
      // A line that two different counts both claim is as ambiguous as a count
      // that two lines both answer. Neither is applied.
      if (takers.has(only.description)) {
        takers.delete(only.description);
        continue;
      }
      takers.set(only.description, stated);
    }

    if (takers.size === 0) return finalLineItems;

    return finalLineItems.map((line) => {
      const stated = takers.get(line.description);
      if (!stated) return line;
      quantityCorrections.push({
        description: line.description,
        from: line.quantity,
        to: stated.quantity,
        span: stated.transcript_span,
      });
      return { ...line, quantity: stated.quantity };
    });
  })();
  finalLineItems = withStatedQuantities;

  const unattached = activePrices.filter(
    (price) =>
      !appliedPrices.has(price) &&
      !price.qualifiers.already_paid &&
      !price.qualifiers.excluded &&
      !labourRefusals.some((refusal) => refusal.price === price),
  );

  const contractorFlags = [
    // Named, never silent. A line leaving the quote is something the contractor
    // has to be able to disagree with — and the one case where they would is
    // exactly the case where they did mean to charge for it.
    ...outOfScope.map(({ description, note }) => outOfScopeLineFlag(description, note)),
    ...unattached.map((price) =>
      unattachedStatedPriceFlag(price.amount / 100, price.transcript_span),
    ),
    ...cappedLines.map(({ description, uncapped, cap }) =>
      cappedLineFlag(description, uncapped, cap),
    ),
    ...labourRefusals.map((refusal) =>
      labourLockRefusedFlag(refusal.price.amount / 100, refusal.description),
    ),
    // Said out loud, with the words that moved it. A quantity change moves the
    // line total, so the contractor has to be able to disagree with it here
    // rather than find it on the customer's copy.
    ...quantityCorrections.map(({ description, from, to, span }) =>
      statedQuantityFlag(description, from, to, span),
    ),
    // A count the guard would not apply because the line is measured in
    // something else. Refusing silently would leave the contractor to notice
    // that eight bags never reached the quote.
    ...unitMismatches.map(({ description, stated, statedUnit, lineUnit }) =>
      unitMismatchFlag(description, stated, statedUnit, lineUnit),
    ),
    ...ownershipRefusals.map(({ price, description }) =>
      customerSuppliedPricedFlag(description, price.amount / 100),
    ),
    // Named, never silent -- the same rule the out-of-scope flag above follows,
    // and for the same reason: the one contractor who WOULD disagree with a
    // line leaving the quote is the one who meant to charge for it.
    ...unrequested.map((description) => unrequestedMaterialFlag(description)),
    // An estimate refused because nothing confirms it, with the figure it
    // would have charged. Only for lines STILL unpriced -- a stated price or a
    // known price landing on the line answers the refusal, and flagging it
    // then would tell the contractor to enter a price they already gave.
    ...unconfirmedEstimates
      .filter(({ description }) =>
        finalLineItems.some((line) => line.description === description && line.unpriced === true),
      )
      .map(({ description, estimate, unit }) =>
        unconfirmedEstimateFlag(description, estimate, unit),
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
    // The restated case, which is not a warning about a number nobody stands
    // behind — it is a change to one. The total may not even have moved (run
    // 16's did not), so the flag says what did: the split, and therefore the
    // price, because the crew are on different rates.
    ...(crewDaysImpossible ? [impossibleCrewDaysFlag(ctx.labour_plan)] : []),
    ...(labourDaysRestated
      ? [statedCrewDaysFlag(labourDaysRestated.statedDays, labourDaysRestated.proposedDays)]
      : []),
  ];

  return { lineItems: finalLineItems, mismatches, contractorFlags };
};
