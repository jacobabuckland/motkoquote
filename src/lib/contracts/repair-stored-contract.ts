import type { LineItem } from "@/lib/schemas/job";
import type { ContractTemplateKey, ContractVariables } from "@/lib/schemas/contract";
import { getContractTemplate } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import { computeQuoteTotals, lineItemTotal } from "@/lib/quote-math";
import { formatGBP } from "@/lib/format";
import { priceBuckets, priceTableControls } from "@/lib/contracts/build-variables";

/**
 * Re-render a contract that was stored before 13 Sep, from the variables it was
 * stored with.
 *
 * WHY THIS EXISTS. `contracts.rendered_body` is written once, at creation
 * (`dashboard/actions.ts`), and never again. Every fix that lands in
 * `build-variables.ts` or `templates.ts` therefore reaches new contracts only.
 * Four defects reported on 13 Sep are baked into the rows already sitting in
 * production, at least one of them in front of a customer who has not signed
 * yet:
 *
 *   1. `Labour £0.00` against the full price on the Materials row — the
 *      inverted derivation. A fixed-price quote collapses to `category: "other"`
 *      and `other` was falling into Materials.
 *   2. The Materials clause opening on its second sentence, because
 *      `materials_statement` did not exist and the paragraph before it
 *      collapsed to nothing.
 *   3. A literal `(**No**)` in the cancellation clause, from a bold-wrapped
 *      variable that should never have been printed.
 *   4. The ink execution block on a contract signed electronically. (Already
 *      neutralised at read time by `strip-ink-signatures.ts`; re-rendering
 *      removes it from the stored row as well.)
 *
 * WHAT IT DOES NOT DO — and this is the load-bearing part:
 *
 * It NEVER rebuilds the variables from the live quote. `contract_date` is
 * "today" at creation, so a rebuild would silently re-date the contract, and a
 * quote edited after the contract was sent would silently restate it. The
 * stored `variables_json` is the contract's own record of what it says, and it
 * is the input here. Only the three values the defects above touch are
 * recomputed; every other variable is passed through byte-for-byte.
 *
 * The quote's line items are read for ONE purpose: to split the subtotal into
 * labour and materials, which the stored variables record only as two formatted
 * strings and cannot be recovered from. That read is gated — see
 * `subtotalMatches` below. If the quote has moved since the contract was
 * created, this refuses to touch the contract rather than guessing.
 */

/** A contract row as this repair needs to see it. */
export type StoredContract = {
  id: string;
  template_key: ContractTemplateKey;
  status: string;
  signed_at: string | null;
  rendered_body: string | null;
  variables_json: ContractVariables | null;
  /** `job_input_json.materials_by`, the only job-input field in scope. */
  materials_by: string | null;
  /** The quote's line items, or null when they could not be read. */
  line_items: LineItem[] | null;
  vat_registered: boolean;
};

export type RepairSkip =
  | "signed"
  | "erased"
  | "no-variables"
  | "no-line-items"
  | "quote-moved"
  | "already-correct";

export type RepairPlan =
  | { action: "skip"; id: string; reason: RepairSkip }
  | {
      action: "repair";
      id: string;
      variables: ContractVariables;
      renderedBody: string;
      /** Which of the four defects this row actually carries. For the log. */
      fixes: string[];
    };

/**
 * The same split `buildContractVariables` now performs, over the same inputs.
 * Kept here rather than imported because that function takes a contractor, a
 * customer and a job input this repair deliberately does not have.
 */
const splitCost = (lineItems: LineItem[], vatRegistered: boolean) => {
  const { subtotal } = computeQuoteTotals(lineItems, vatRegistered);
  const materials =
    Math.round(
      lineItems
        .filter((item) => item.category === "materials")
        .reduce((sum, item) => sum + lineItemTotal(item), 0) * 100,
    ) / 100;
  return { subtotal, materials, labour: Math.round((subtotal - materials) * 100) / 100 };
};

/** The fallback wording approved by Jacob on 13 Sep, verbatim. */
export const materialsStatementFor = (materialsBy: string | null): string =>
  materialsBy
    ? `Materials will be supplied by: **${materialsBy}**.`
    : "Responsibility for supplying materials is as set out in the scope of work in clause 1.";

export const planContractRepair = (contract: StoredContract): RepairPlan => {
  const skip = (reason: RepairSkip): RepairPlan => ({ action: "skip", id: contract.id, reason });

  // A signed contract is the document the customer agreed to. Correcting it
  // after execution is not a backfill, it is altering an executed agreement.
  // Whatever it says, it keeps saying.
  if (contract.signed_at !== null || contract.status === "signed") return skip("signed");
  // Erased accounts null the body and empty the variables (account-erasure.ts).
  if (!contract.rendered_body) return skip("erased");
  if (!contract.variables_json) return skip("no-variables");
  if (!contract.line_items) return skip("no-line-items");

  const stored = contract.variables_json;
  const { subtotal, labour, materials } = splitCost(contract.line_items, contract.vat_registered);

  // THE GATE. The contract records its own subtotal as a formatted string. If
  // recomputing it from today's line items does not reproduce that string
  // exactly, the quote has been edited since the contract was sent and these
  // line items are not the ones this contract was priced from. Refuse.
  if (formatGBP(subtotal) !== stored.subtotal) return skip("quote-moved");

  const repaired: ContractVariables = {
    ...stored,
    labour_cost: formatGBP(labour),
    materials_cost: formatGBP(materials),
    materials_statement: materialsStatementFor(contract.materials_by),
    // The clause 2 table's controls did not exist when any of these rows were
    // written, so spreading `stored` alone leaves them absent — and the
    // renderer reads absent as false. This script would then DELETE the Labour,
    // Materials and VAT rows from every contract it repaired, taking the VAT
    // amount and the VAT number off a priced document.
    //
    // Derived from what this contract itself records, never from the
    // contractor's current settings, which is the rule the rest of this file
    // follows: a registration toggled since the contract was sent cannot change
    // what it says.
    // From the quote's own lines, which this already reads to recompute the
    // split. A stored contract asserting Labour £2,602.90 against a quote whose
    // only labour line is £2,200 is what this corrects.
    ...priceTableControls({
      buckets: priceBuckets(contract.line_items),
      vatAmount: stored.vat_amount ?? formatGBP(0),
      vatRegistered: Boolean(stored.vat_registered),
      vatNumber: stored.vat_number ?? null,
    }),
  };

  const renderedBody = renderContractTemplate(
    getContractTemplate(contract.template_key).body,
    repaired,
  );

  if (renderedBody === contract.rendered_body) return skip("already-correct");

  const fixes: string[] = [];
  // Any row of the price table moving, not `labour_cost` alone. Since the table
  // became one row per category, a contract whose stored Labour was already
  // £0.00 can still be materially corrected — the £450 that used to sit on
  // Materials moving to Other works changes what the customer is told without
  // changing labour_cost at all.
  const PRICE_ROWS = [
    "labour_cost",
    "materials_cost",
    "travel_cost",
    "callout_cost",
    "other_cost",
    "provisional_cost",
  ] as const;
  if (PRICE_ROWS.some((row) => repaired[row] !== stored[row])) fixes.push("price table");
  if (repaired.materials_statement !== (stored.materials_statement ?? "")) {
    fixes.push("materials clause opening");
  }
  // Both of these are template-side, so they are detected on the stored body
  // rather than on the variables.
  if (/\(\*\*(Yes|No)\*\*\)/.test(contract.rendered_body)) fixes.push("cancellation artefact");
  if (/\*\*Signed by the Contractor:\*\*/.test(contract.rendered_body)) {
    fixes.push("ink execution block");
  }
  if (fixes.length === 0) fixes.push("template wording");

  return { action: "repair", id: contract.id, variables: repaired, renderedBody, fixes };
};
