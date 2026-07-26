import type { LineItem } from "@/lib/schemas/job";
import { resolvePricingMode, type SowState } from "@/lib/schemas/sow";

// Fixed-mode pricing (see pricingModeSchema in schemas/sow.ts).
//
// When the contractor states a single total for the job ("call it two grand"),
// the quote collapses to ONE priced works line at that net figure — no
// materials/labour breakdown — plus any provisional sums carried through
// unchanged. VAT is applied on top by computeQuoteTotals per registration, so
// nothing here touches VAT. The stated figure is the user's own number, not an
// LLM-computed one, so this respects the pricing contract: the model never
// invents the amount, it only records the one the contractor said.

// Turns a job_type into a customer-facing works-line description. Sentence-
// cases the trade and appends "works as described" so a bare "plastering"
// reads as "Plastering works as described"; falls back to a neutral phrase
// when the job_type is empty.
export const deriveWorksDescription = (jobType: string): string => {
  const trimmed = jobType.trim();
  if (trimmed === "") return "Works as described";
  const sentenceCased = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return `${sentenceCased} works as described`;
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
  };
  return [worksLine, ...provisionalItems];
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
): LineItem[] => {
  const mode = resolvePricingMode(sow);
  const fixedAmount = sow.pricing?.fixed_amount ?? null;
  if (mode === "fixed" && fixedAmount != null) {
    const provisionals = calculatedLineItems.filter((item) => item.provisional === true);
    return buildFixedModeLineItems(deriveWorksDescription(sow.job_type), fixedAmount, provisionals);
  }
  return calculatedLineItems;
};
