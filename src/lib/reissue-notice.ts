import { formatMessageAmount } from "@/lib/money-label";

/**
 * ✅ CUSTOMER-FACING COPY — APPROVED BY JACOB, 13 SEP.
 *
 * `AGENTS.md` puts customer-facing copy on the escalation list. This wording IS
 * that human decision, recorded on the #727 card, and **an implementer may not
 * vary it**. Change the logic around it freely; not the strings.
 *
 * Figures go through `formatMessageAmount(total, vatRegistered)`, never
 * `formatGBP` — the existing send path does, and it is what keeps the VAT
 * presentation right for a registered trade.
 *
 * THE SENTENCE THAT MAY NOT BE SOFTENED:
 *
 *   "Because the quote has changed, your earlier acceptance no longer stands."
 *
 * It is the only place the customer learns their agreement is gone. Anything
 * gentler — "we've made a small update", "just to let you know" — leaves them
 * believing they are still covered, which is the whole failure this exists to
 * prevent. It is identical in every variant below.
 *
 * Three properties of the copy, each load-bearing:
 *
 *  1. It names both figures. A customer holding two numbers with no idea which
 *     is live is the defect, not the wording.
 *  2. It attributes the change to the trade by name, so the customer knows who
 *     to ask.
 *  3. It does not accuse the trade. The common case is an honest correction,
 *     and this lands on the trade's document, to their customer.
 */

const ACCEPTANCE_WITHDRAWN =
  "Because the quote has changed, your earlier acceptance no longer stands.";

export type ReissueFacts = {
  companyName: string;
  customerName: string;
  /** The total now, in pounds. */
  newTotal: number;
  /** What the customer was last told, in pounds. */
  oldTotal: number;
  vatRegistered: boolean;
  quoteUrl: string;
};

/**
 * Whether the money moved.
 *
 * A SCOPE-ONLY EDIT IS A REQUIRED VARIANT, not a nicety. This item re-issues
 * the SoW as well as the quote, so an edit can change what the job covers
 * without moving the total — and the figure sentence is then false. Compared in
 * PENCE so a rounding difference of less than a penny does not read as a
 * change, and so two equal totals cannot fail an equality test on floats.
 */
export const totalMoved = (oldTotal: number, newTotal: number): boolean =>
  Math.round(oldTotal * 100) !== Math.round(newTotal * 100);

/** Subject line. A customer who has already accepted believes they are done. */
export const reissueEmailSubject = (companyName: string): string =>
  `Your updated quote from ${companyName} — please accept again`;

export const reissueEmailBody = (facts: ReissueFacts): string => {
  const amount = formatMessageAmount(facts.newTotal, facts.vatRegistered);
  const opening = totalMoved(facts.oldTotal, facts.newTotal)
    ? `${facts.companyName} has updated the quote you accepted. The amount is now ${amount} — it was ${formatMessageAmount(facts.oldTotal, facts.vatRegistered)}.`
    : `${facts.companyName} has updated the quote you accepted. The amount is unchanged at ${amount}, but the details have changed.`;

  return [
    `Hi ${facts.customerName},`,
    opening,
    `${ACCEPTANCE_WITHDRAWN} Please review the updated quote and accept it if you're happy with it.`,
    facts.quoteUrl,
    `If you were expecting the earlier figure, contact ${facts.companyName} before accepting.`,
  ].join("\n\n");
};

export const reissueSmsBody = (facts: ReissueFacts): string => {
  const amount = formatMessageAmount(facts.newTotal, facts.vatRegistered);
  const opening = totalMoved(facts.oldTotal, facts.newTotal)
    ? `your quote has changed — ${amount} (was ${formatMessageAmount(facts.oldTotal, facts.vatRegistered)}).`
    : `your quote has changed — the amount is unchanged at ${amount}, but the details have changed.`;

  return `${facts.companyName}: ${opening} Your earlier acceptance no longer stands, so please review and accept the new one: ${facts.quoteUrl}`;
};

/** The label the Activity timeline records. Decision (3) overwrites the quote body; the job's history is not overwritten with it. */
export const REISSUE_TIMELINE_LABEL = "Quote re-issued";
