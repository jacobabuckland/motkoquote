/**
 * The contractor declining to price something, in this call, for this job.
 *
 * Scenario 302 of the 20 Sep tranche: the contractor said the price was not to
 * be confirmed yet, and the quote billed GBP 600 of finish anyway -- at
 * GBP 60/bag, taken from a price the contractor had confirmed on some earlier
 * job. Every guard behaved: a confirmed price is exactly what #839 says may be
 * charged, because it is the contractor's own figure rather than an invention.
 *
 * It is still the wrong answer. A price on file is what this contractor
 * charged LAST TIME; an instruction in the call is what they want THIS TIME,
 * and a default that overrides a current instruction is not a default. Jacob's
 * call, 20 Sep: an explicit instruction outranks a saved price, and the saved
 * figure comes back as a suggestion to confirm.
 *
 * THE DIRECTION OF ERROR IS THE OPPOSITE OF THE OTHER READERS, and the rules
 * here are looser because of it. Reading a deferral that was not there leaves
 * a line unpriced with the figure offered beside it: the contractor types it
 * in, nobody is overcharged, and the quote cannot be sent until they look.
 * MISSING one charges money the contractor said not to charge yet. So where
 * the price and quantity readers refuse on doubt, this one acts on it.
 *
 * What it is not: a reader of hesitation. "I think it's about twelve quid"
 * is an uncertain PRICE, which `containsHedge` already refuses at the point
 * the amount is read. This is the contractor saying there is no price to
 * record, deliberately, and asking for it to be left.
 *
 * Pure function, no API calls. Money integrity depends on determinism.
 */

import { splitIntoSentences, turnsAreValid } from "@/lib/voice/stated-prices";
import type { TranscriptTurn } from "@/lib/voice-transcript";

/** A sentence in which the contractor declined to put a price on something. */
export interface PricingDeferral {
  /** The sentence as said, so a flag can quote it and the compiler can scope it. */
  transcript_span: string;
}

/**
 * Declining to price, in the forms a trade actually uses.
 *
 * Each alternative is anchored on the contractor doing something with a PRICE:
 * refusing to put one on, putting one off, or saying they do not have one yet.
 * A sentence that merely contains the word "price" is not a deferral -- "the
 * price is twelve pounds a bag" would otherwise unprice the line it just
 * priced.
 */
const DEFERS_A_PRICE = new RegExp(
  [
    // "don't price it", "do not price the finish", "don't put a price on"
    String.raw`\b(?:do\s*n[o']?t|do\s+not|never)\s+(?:price|put\s+(?:a\s+)?price|quote\s+(?:a\s+)?price)`,
    // "leave the price", "leave it unpriced", "leave the prices out/blank/open"
    String.raw`\bleave\s+(?:the\s+|that\s+|it\s+|them\s+)?(?:price|prices|pricing|unpriced|it\s+unpriced)`,
    // "price it later", "price them up later", "price that separately"
    String.raw`\bprice\s+(?:it|that|them|these|those|this|up)?\s*(?:up\s+)?(?:later|afterwards|separately|another\s+time)`,
    // "I'll confirm the price", "I need to check the price", "let me get the price"
    String.raw`\b(?:i(?:'ll| will|\s+need\s+to|\s+have\s+to|\s+want\s+to)|let\s+me)\s+(?:confirm|check|get|find\s+out|look\s+up|price)\s+(?:up\s+)?(?:the\s+|that\s+|those\s+|their\s+)?(?:price|prices|cost|costs)`,
    // "I don't know the price", "I haven't got the price yet"
    String.raw`\bi\s*(?:do\s*n[o']?t|have\s*n[o']?t|haven'?t|don'?t)\s+(?:know|have|got|get)\s+(?:the\s+|a\s+|their\s+)?(?:price|prices|cost|costs)`,
    // "price to be confirmed", "price is TBC", "prices are unconfirmed"
    String.raw`\b(?:price|prices|pricing|cost|costs)\s+(?:is\s+|are\s+|to\s+be\s+)?(?:to\s+be\s+confirmed|tbc|unconfirmed|not\s+confirmed|not\s+yet\s+confirmed)`,
    // "not priced yet", "no price yet", "unpriced for now"
    String.raw`\b(?:not\s+priced|no\s+price|unpriced)\s+(?:yet|for\s+now|at\s+this\s+stage)`,
  ].join("|"),
  "i",
);

/**
 * Every sentence in which the contractor declined to price something.
 *
 * ONLY WHAT THE CONTRACTOR SAID, for the reason #832 established on counts and
 * #842 restated on materials: the assistant's half of the call is not evidence
 * of what the contractor wants. Here it would be worse than a wrong number --
 * an assistant offering "shall I leave the prices for now?" would, read whole,
 * unprice a quote nobody asked to leave.
 */
export function extractPricingDeferrals(
  transcript: string,
  turns?: TranscriptTurn[],
): PricingDeferral[] {
  if (!transcript || transcript.trim().length === 0) return [];

  const sources = turnsAreValid(turns)
    ? turns.filter((turn) => turn.speaker === "contractor").map((turn) => turn.text)
    : [transcript];

  const found: PricingDeferral[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    for (const sentence of splitIntoSentences(source)) {
      const span = sentence.trim();
      if (span.length === 0 || seen.has(span)) continue;
      if (!DEFERS_A_PRICE.test(span)) continue;
      seen.add(span);
      found.push({ transcript_span: span });
    }
  }

  return found;
}
