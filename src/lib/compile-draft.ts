import type { DraftLineItem, LineItem, LinePerson } from "@/lib/schemas/job";
import { normalize } from "@/lib/rate-card-matching";
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

const compileProvisional = (
  draft: Extract<DraftLineItem, { kind: "provisional" }>,
): LineItem =>
  withCustomerNote(
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

/**
 * Fuzzy match a draft line description to a stated price item.
 * Normalizes and compares words, requiring at least 2 shared significant words.
 */
const matchStatedPrice = (
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
    if (itemWords.length === 0 || descWords.length === 0) continue;

    const shared = descWords.filter((w) => itemWords.includes(w));
    if (shared.length >= 2) return price;
  }

  return undefined;
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

  // Handle 'each' qualifier: stated price is per unit
  if (statedPrice.qualifiers.each) {
    const qty = quantity ?? item.quantity ?? 1;
    return {
      ...item,
      unit_price: amountPounds,
      quantity: qty,
      assumed: false,
    };
  }

  // For non-'each' prices, the stated amount is the total
  // We apply it as unit_price with quantity 1
  return {
    ...item,
    unit_price: amountPounds,
    quantity: 1,
    assumed: false,
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

  // Track which stated prices have been matched (to detect fitted items)
  const matchedPrices = new Map<StatedPrice, LineItem[]>();

  const labourDrafts = drafts.filter(
    (d): d is Extract<DraftLineItem, { kind: "labour" }> => d.kind === "labour",
  );
  if (labourDrafts.length > 0) {
    const labourLine = compileLabour(labourDrafts, ctx, mismatches);
    const matchedPrice = matchStatedPrice(labourLine.description, statedPrices);
    if (matchedPrice) {
      if (!matchedPrices.has(matchedPrice)) {
        matchedPrices.set(matchedPrice, []);
      }
      matchedPrices.get(matchedPrice)!.push(labourLine);
    }
    lineItems.push(labourLine);
  }

  for (const draft of drafts) {
    let item: LineItem | null = null;

    if (draft.kind === "material") item = compileMaterial(draft, ctx, mismatches);
    else if (draft.kind === "rate_card") item = compileRateCard(draft, ctx, mismatches);
    else if (draft.kind === "provisional") item = compileProvisional(draft);

    if (item) {
      const matchedPrice = matchStatedPrice(item.description, statedPrices);
      if (matchedPrice) {
        if (!matchedPrices.has(matchedPrice)) {
          matchedPrices.set(matchedPrice, []);
        }
        matchedPrices.get(matchedPrice)!.push(item);
      }
      lineItems.push(item);
    }
  }

  // Apply stated prices to matched lines
  const finalLineItems: LineItem[] = [];
  const processedPrices = new Set<StatedPrice>();

  for (const item of lineItems) {
    const matchedPrice = matchStatedPrice(item.description, statedPrices);

    if (!matchedPrice) {
      // No stated price: use the line as-is
      finalLineItems.push(item);
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
        finalLineItems.push(applied);
      }
    } else {
      // Not fitted: apply stated price normally
      const draft = drafts.find((d) => normalize(d.description) === normalize(item.description));
      const quantity = draft && "quantity" in draft ? draft.quantity : item.quantity;

      const applied = applyStatedPrice(item, matchedPrice, quantity);
      if (applied) {
        finalLineItems.push(applied);
      }
    }
  }

  // Route contractor-directed notes off every line and into the editor-only
  // flag list — prefix with the line description for context. Job-level flags
  // (people not in team_members, etc.) pass straight through.
  const contractorFlags = [
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
    ...(finalLineItems.some((item) => item.unpriced) ? [UNRESOLVED_RATE_FLAG] : []),
  ];

  return { lineItems: finalLineItems, mismatches, contractorFlags };
};
