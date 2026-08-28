import { formatGBP } from "@/lib/format";

/**
 * ⚠️ CUSTOMER-FACING COPY — PROPOSED, NOT APPROVED.
 *
 * `AGENTS.md` puts customer-facing contractual copy on the escalation list, and
 * #370 records the wording as the one piece of human input still outstanding.
 * These strings are a starting point for that decision, not a substitute for
 * it. They are isolated in this module so the wording can be changed without
 * touching the logic that decides when to show it.
 *
 * Three constraints shaped the drafts below, and a replacement should keep all
 * three:
 *
 *  1. **It must not accuse the trade.** The overwhelmingly common case is an
 *     honest correction — a contractor fixing a price they got wrong — and the
 *     notice appears on their document, to their customer. Wording that
 *     implies concealment would do more damage than the silence it replaces.
 *  2. **It must name both figures.** The whole failure is a customer holding
 *     two numbers with no idea which is current. A notice that says "this has
 *     changed" without saying from what leaves them exactly as stuck.
 *  3. **It must not claim to say when.** `updated_at` starts recording only
 *     from migration 051, and for a quote sent before that there is no honest
 *     answer. Saying "updated today" when the row was backfilled would be a
 *     fabrication on a customer-facing document.
 */

/** Heading for the disclosure notice on the public quote page. */
export const SENT_QUOTE_CHANGED_HEADING = "This quote has been updated";

/**
 * Body of the disclosure notice. Names both figures and attributes the change
 * to the contractor by company name, so the customer knows who to ask.
 */
export const sentQuoteChangedNote = (
  companyName: string,
  sentTotal: number,
  currentTotal: number,
): string =>
  `An earlier message quoted ${formatGBP(sentTotal)}. ${companyName} has since ` +
  `updated this quote to ${formatGBP(currentTotal)}, which is the amount shown ` +
  `below and the one that applies. If you were expecting the earlier figure, ` +
  `contact ${companyName} before accepting.`;

/**
 * Shown to the CONTRACTOR in the editor, before the edit lands, when the quote
 * has already been sent.
 *
 * The re-send button's own label is NOT here — it lives with the other send
 * states in send-button-label.ts, so the button's vocabulary has one home and
 * cannot drift between "Send quote", "Sending…" and "Re-send to customer". Deliberately phrased around what the customer will
 * see, because that is the fact the contractor does not currently have.
 */
export const EDIT_AFTER_SEND_WARNING =
  "You've already sent this quote. If you change the total, the customer's " +
  "copy will show a notice that the amount has changed — re-send it so they " +
  "get the new figure directly.";
