import type { LineItem } from "@/lib/schemas/job";

/**
 * What the invoice is FOR, in the words the customer already agreed to.
 *
 * Reported 14 Sep: `/i/[id]` named no supply at all. The first pass at fixing
 * that put `jobs.extracted_json.job_type` under a "For" heading, which is a
 * category — "Plastering" — not a description of what was done. An accountant
 * asked to accept a £3,620.28 invoice reading "For: Plastering" bounces it, and
 * they are right to: a VAT invoice has to identify the goods or services
 * supplied and their extent.
 *
 * The quote's line items are that description, and the customer has already
 * seen them — on the quote page, on the PDF and in Schedule A of the contract.
 * Restating them here means the invoice says the same thing those documents do,
 * in the same words, which is the whole point.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not price the lines. A deposit is
 * a payment on account against the whole supply, so putting £500 next to
 * "Reskim hallway ceiling" on a £222 deposit invoice would invite exactly the
 * arithmetic that does not work. The amount is stated once, in the totals
 * block, where it is the invoice's own figure — and `heading` says what that
 * figure is against.
 */
export type SupplyDescription = {
  /** Names the relationship between the amount charged and the work listed. */
  heading: string;
  /** One line per item of work, each carrying its extent. */
  lines: string[];
};

/**
 * The extent of one line, phrased exactly as the quote PDF phrases it
 * (`{quantity} {unit}` — "12 m2", "2 day", "1 job"), so a customer holding both
 * documents sees one description, not two.
 *
 * A single unnamed unit adds nothing a reader cannot see, so `1 job` is
 * dropped; anything else is kept, because "2 day" and "1 day" are a different
 * supply and the difference belongs on the invoice.
 */
const extentOf = (item: Pick<LineItem, "quantity" | "unit">): string | null => {
  if (!item.unit) return null;
  if (item.quantity === 1 && item.unit === "job") return null;
  return `${item.quantity} ${item.unit}`;
};

export const describeSupplyLine = (item: Pick<LineItem, "description" | "quantity" | "unit">): string => {
  const extent = extentOf(item);
  return extent ? `${item.description} — ${extent}` : item.description;
};

/**
 * `invoiceType` is the recorded column, not a comparison of amounts.
 *
 * A deposit is partial by definition and says so; a closing invoice is not
 * necessarily the whole supply either — a job that took a deposit closes with
 * the balance — and that is why the closing heading says the amount is "for"
 * the work rather than claiming it is the price of it. Deriving the wording by
 * comparing the invoice amount to the quote total would make the heading move
 * when a variation or a discount moved, which is a different question and the
 * contractor's to answer.
 */
export function describeSupply(input: {
  invoiceType: string;
  lineItems: LineItem[];
  /** Used only when the quote carries no line items at all. */
  jobType?: string | null;
}): SupplyDescription | null {
  const lines = input.lineItems
    .map((item) => describeSupplyLine(item))
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    // A quote with no readable line items. The job type is weak, but it is
    // better than a blank "For" section, and it is never presented as an
    // itemisation.
    const fallback = input.jobType?.trim();
    if (!fallback) return null;
    return {
      heading: input.invoiceType === "deposit" ? "Deposit for" : "For",
      lines: [fallback],
    };
  }

  return {
    heading: input.invoiceType === "deposit" ? "Deposit against" : "For",
    lines,
  };
}
