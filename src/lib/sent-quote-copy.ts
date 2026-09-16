import { formatGBP } from "@/lib/format";

/**
 * ✅ CUSTOMER-FACING COPY — APPROVED BY JACOB, 13 SEP 2026.
 *
 * `AGENTS.md` puts customer-facing contractual copy on the escalation list.
 * That approval is recorded on the #727 card and in `areas/motko.md`, and it
 * covers #370's divergence notice in the tightened form below. **An implementer
 * may not vary these strings.** The logic that decides when to show them is
 * free to change; the wording is not.
 *
 * The banner above used to read "PROPOSED, NOT APPROVED", which was true when
 * it was written and became the reason a later agent might rewrite approved
 * copy. It is updated here rather than left to rot.
 *
 * They stay isolated in this module so the wording can be changed — by Jacob —
 * without touching the logic that decides when to show it.
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
/**
 * Shown while editing a quote the customer has ACCEPTED, and it says something
 * different from the sent-quote warning below: not "your two copies will
 * disagree" but "you are about to withdraw their agreement".
 *
 * Pass 12 caught the gap. `editWillDiverge` is `status === "sent"`, so an
 * accepted quote produced no warning at all — the contractor changed a quantity,
 * got "Saved", and the job silently reverted from "✓ Accepted" to "Waiting on
 * QA to accept the quote" with the customer's acceptance gone.
 *
 * Not gated on the total moving. Saving an accepted quote clears `accepted_at`
 * whether or not the figure changed, so the warning has to appear on any edit.
 */
export const EDIT_AFTER_ACCEPT_WARNING =
  "Your customer has accepted this quote. Saving a change withdraws their " +
  "acceptance and re-issues it — they'll be told the quote has changed and " +
  "asked to accept again.";

export const EDIT_AFTER_SEND_WARNING =
  "You've already sent this quote. If you change the total, the customer's " +
  "copy will show a notice that the amount has changed — re-send it so they " +
  "get the new figure directly.";
