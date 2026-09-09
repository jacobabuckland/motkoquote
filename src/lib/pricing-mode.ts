import type { LineItem } from "@/lib/schemas/job";
import { resolvePricingMode, type SowState } from "@/lib/schemas/sow";
import { definedWorksLines, provisionalLines } from "@/lib/quote-lines";
import { sumLines } from "@/lib/quote-math";
import { samePrice } from "@/lib/money-compare";

// Fixed-mode pricing (see pricingModeSchema in schemas/sow.ts).
//
// When the contractor states a single total for the job ("call it two grand"),
// the quote collapses to ONE priced works line at that net figure — no
// materials/labour breakdown — plus any provisional sums carried through
// unchanged. VAT is applied on top by computeQuoteTotals per registration, so
// nothing here touches VAT. The stated figure is the user's own number, not an
// LLM-computed one, so this respects the pricing contract: the model never
// invents the amount, it only records the one the contractor said.

// Turns a job_type into a customer-facing works-line description.
//
// This used to append "works as described" unconditionally, so a fixed-price
// quote collapsed to one line reading "Rewire works as described" — where
// "described" referred to a statement of work the customer had never been
// sent, because the quote PDF carried no scope at all. The phrase pointed at
// nothing.
//
// It now says where the description is, and only when there is one to point
// at. With a scope section on the document the line refers to it; without one
// it makes no promise it cannot keep.
export const deriveWorksDescription = (
  jobType: string,
  hasScopeSection: boolean,
): string => {
  const trimmed = jobType.trim();
  const suffix = hasScopeSection ? " — see Scope of work" : "";
  if (trimmed === "") return `Works${suffix}`;
  const sentenceCased = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return `${sentenceCased} works${suffix}`;
};

// Builds the line items for a fixed-price quote: a single works line at the
// stated net amount, followed by any provisional-sum lines from the calculated
// draft (they price separately and remain editable — a fixed price covers the
// defined works, not the unknowns). Pure and deterministic.
export const buildFixedModeLineItems = (
  worksDescription: string,
  fixedAmount: number,
  provisionalItems: LineItem[],
): LineItem[] => {
  const worksLine: LineItem = {
    description: worksDescription,
    category: "other",
    quantity: 1,
    unit: "job",
    unit_price: fixedAmount,
    multiplier: 1,
    people_count: 1,
    overtime: false,
    assumed: false,
    assumption_note: undefined,
    customer_note: undefined,
    provenance: {
      source: "system-generated",
    },
  };
  return [worksLine, ...provisionalItems];
};

// WHAT A FIXED PRICE ABSORBS, and why it has to be said out loud.
//
// The collapse itself is right: the contractor gave one number for the whole
// job, so the quote carries one line at that number. What was wrong is that it
// happened in silence, and that the guard which would have caught it runs too
// late to see anything.
//
// reconcileStatedPrice compares `pricing.fixed_amount` against the ACTIVE lines.
// After a collapse those lines ARE the works line at fixed_amount, so it
// compares £1,800 against £1,800, agrees with itself, and reports nothing. The
// divergence it exists to find was erased one step earlier.
//
// Quote 46e3d510: four drafted lines totalling £2,355.98 became one line at
// £1,800, VAT was charged on £1,800, and the quote was accepted at £2,160.
// £555.98 of priced work left the document with nothing said. The contractor had
// stated £1,800 labour AND £400 materials — two figures for a field that holds
// one — so the absorbed value was not a discount they chose.
//
// This compares the stated amount against the DEFINED WORKS of the calculated
// breakdown, which is the comparison that still has both numbers in it. It does
// not block and it does not change a price: a contractor genuinely discounting
// their own quote is doing something legitimate and the product should honour
// it. It just refuses to let the difference go unmentioned.
export const FIXED_PRICE_ABSORBED_PREFIX = "Fixed price is under the priced work: ";

export const fixedPriceAbsorbedFlag = (stated: number, definedWorks: number): string =>
  `${FIXED_PRICE_ABSORBED_PREFIX}you set £${stated.toFixed(2)} for the whole job, ` +
  `but the priced work came to £${definedWorks.toFixed(2)}. The difference of ` +
  `£${(definedWorks - stated).toFixed(2)} is absorbed into the single works line. ` +
  `Check the fixed price is right before sending.`;

/**
 * The flag for a fixed price that covers less than the work priced under it, or
 * null when there is nothing to say.
 *
 * Takes the CALCULATED breakdown, not the active lines — after the collapse the
 * active lines no longer carry the figure being compared.
 *
 * Silent when the stated price MEETS or EXCEEDS the priced work: a contractor
 * pricing above their own breakdown has added something the draft did not know
 * about, which is theirs to do and nothing to warn about.
 */
export const absorbedByFixedPrice = (
  sow: Pick<SowState, "pricing">,
  calculatedLineItems: LineItem[],
): string | null => {
  if (resolvePricingMode(sow) !== "fixed") return null;
  const stated = sow.pricing?.fixed_amount ?? null;
  if (stated == null || stated <= 0) return null;

  const definedWorks = sumLines(definedWorksLines(calculatedLineItems));
  // Provisionals are excluded on both sides: they carry through the collapse
  // untouched, so they are not absorbed by anything.
  if (definedWorks <= 0 || samePrice(stated, definedWorks) || stated > definedWorks) {
    return null;
  }
  return fixedPriceAbsorbedFlag(stated, definedWorks);
};

// Selects the ACTIVE line items for a quote given its pricing mode, from the
// full calculated breakdown. "fixed" collapses to a single works line at the
// stated amount plus the calculated provisional sums; "days"/"calculated" both
// use the breakdown unchanged (days just means the contractor stated the
// duration explicitly — it prices the same way). The calculated breakdown is
// always kept separately (drafted_line_items_json) so switching back out of
// fixed mode can rebuild it without re-invoking the LLM.
export const applyPricingMode = (
  calculatedLineItems: LineItem[],
  sow: Pick<SowState, "pricing" | "job_type">,
  // Whether the rendered document will carry a scope section. Defaults false
  // so a caller that cannot know (the quote editor recomputing a preview)
  // never produces a line promising a section that may not exist.
  hasScopeSection = false,
): LineItem[] => {
  const mode = resolvePricingMode(sow);
  const fixedAmount = sow.pricing?.fixed_amount ?? null;

  // Legacy jobs: pricing was never set (pre-Task B). Keep producing the
  // calculated breakdown — an explicit, commented decision, not a silent
  // fallback. Existing jobs must not change price.
  if (mode === null) {
    return calculatedLineItems;
  }

  if (mode === "fixed" && fixedAmount != null) {
    // The provisional sums survive; the defined works are replaced by the single
    // stated line. Named via quote-lines so this and reconcileStatedPrice are
    // visibly talking about the same partition rather than each restating it.
    const provisionals = provisionalLines(calculatedLineItems);
    return buildFixedModeLineItems(
      deriveWorksDescription(sow.job_type, hasScopeSection),
      fixedAmount,
      provisionals,
    );
  }
  return calculatedLineItems;
};
