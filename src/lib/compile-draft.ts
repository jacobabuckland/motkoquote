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
  // Optional so every existing caller keeps its current behaviour: absent means
  // "assume history", which is what the compiler did before this existed.
  has_pricing_history?: boolean;
};

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
    assumed: false,
    people,
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
      { ...common, unit_price: known.unit_price, assumed: false },
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

  // Handle 'each' qualifier: stated price is per unit
  if (statedPrice.qualifiers.each) {
    const qty = quantity ?? item.quantity ?? 1;
    return {
      ...item,
      unit_price: amountPounds,
      quantity: qty,
      assumed: false,
      provenance,
    };
  }

  // For non-'each' prices, the stated amount is the total
  // We apply it as unit_price with quantity 1
  return {
    ...item,
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

  // Provenance checks apply only when statedPrices is non-empty (meaning price
  // extraction ran). An empty array means either a pre-PRICE-1 legacy draft or
  // the guest funnel (which has no transcript extraction); in both, materials
  // with estimated costs must keep pricing normally.
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
  if (labourDrafts.length > 0) {
    lineItems.push(compileLabour(labourDrafts, ctx, mismatches));
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
          // Clear provenance — unsourced lines have none
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
  ];

  return { lineItems: finalLineItems, mismatches, contractorFlags };
};
