/**
 * "These are customer prices" is a statement about PRICING, not about supply.
 *
 * WHY THIS EXISTS. Scenario 41's contractor ended a materials list with
 *
 *   "These are customer prices before VAT with no markup."
 *
 * and intake recorded `materials_supply.responsibility: "customer"`. Every
 * layer below then behaved correctly on a wrong premise: both materials were
 * marked customer-supplied, held at GBP 0 by the unconfirmed-price rule, and
 * the quote came out at GBP 250 against GBP 371. The words "customer" and
 * "supplies" sit one slot apart in that schema field, and "customer ... prices"
 * reads straight onto it.
 *
 * In the trade, a customer price is the SELL price — what the customer is
 * charged, as against trade price or cost price. A contractor quoting one for a
 * material is charging for that material, which is the opposite of the customer
 * buying it themselves.
 *
 * #845 rewrote the schema description to ask who BUYS and to say outright that
 * a pricing phrase is not an answer. That is the right fix and it is not a
 * guaranteed one: a prompt is a request, and three identical replays of 41 all
 * still came back customer-supplied. This module is the part that does not
 * depend on the model reading its instructions.
 *
 * WHAT IT IS NOT. It is not "a price was stated, so the contractor must be
 * supplying". A contractor can say what customer-supplied materials cost, and
 * often does — "the customer's getting the bags, they're about twelve quid" is
 * an ordinary sentence and it means the customer supplies them. Nothing here
 * reads a price. It reads one idiom: the word customer or client governing a
 * price noun. That is a narrow, quotable phrase, which is what lets the
 * correction be read back to the contractor in their own words.
 *
 * WHAT OUTRANKS IT. An explicit statement of supply, always — see
 * materials-ownership.ts, which only consults this when the contractor said
 * nothing plain either way, and raises a conflict rather than acting when they
 * said both.
 */

import { contractorSaid } from "@/lib/voice/contractor-said";
import type { TranscriptTurn } from "@/lib/voice-transcript";

/**
 * The idiom, in the three shapes a trade says it.
 *
 * Deliberately anchored on a PRICE NOUN governed by customer/client. "Customer
 * supplied", "customer's materials" and "the customer's bags" are not this and
 * must not match — the first two are supply claims and belong to the reader
 * that handles those.
 */
const CUSTOMER_PRICE_IDIOM = new RegExp(
  [
    // "customer prices", "client rate", "customer-facing price" is not needed;
    // the hyphen form "customer-price" is, because dictation writes it.
    String.raw`\b(?:customer|client)[\s-]+(?:price|prices|pricing|rate|rates)\b`,
    // "prices to the customer", "the rate to the client"
    String.raw`\b(?:price|prices|rate|rates)\s+to\s+the\s+(?:customer|client)\b`,
    // "what the customer pays"
    String.raw`\bwhat\s+the\s+(?:customer|client)\s+pays\b`,
  ].join("|"),
  "i",
);

/**
 * The idiom as the contractor said it, or null.
 *
 * Returns the matched words rather than a boolean so the correction can quote
 * them. A contractor reading "you said 'customer prices'" can disagree with it;
 * one reading "ownership was corrected" cannot.
 */
export function statedCustomerPrices(said: string | null | undefined): string | null {
  const match = (said ?? "").match(CUSTOMER_PRICE_IDIOM);
  return match ? match[0].trim() : null;
}

/**
 * The same question, asked of a call rather than a string.
 *
 * CONTRACTOR TURNS ONLY. Motko asks "and are those customer prices?" in the
 * ordinary course of an intake, and reading the whole transcript would take the
 * assistant's question as the contractor's answer — the #832 lesson on counts,
 * where Motko repeating a number back was read as the contractor stating it.
 * Here it would be worse: the assistant's own phrasing would move who pays for
 * the materials.
 */
export function callStatedCustomerPrices(
  transcript: string | null | undefined,
  turns?: TranscriptTurn[] | null,
): string | null {
  return statedCustomerPrices(contractorSaid(transcript, turns));
}
