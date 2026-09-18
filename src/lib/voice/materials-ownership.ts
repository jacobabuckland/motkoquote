import type { MaterialsSupply } from "@/lib/schemas/job";
import { splitIntoSentences } from "@/lib/voice/stated-prices";

/**
 * Reconcile who supplies each material against what the contractor actually
 * said, after intake capture and before drafting.
 *
 * WHY THIS EXISTS. On job 1d6389a8 the contractor said "6 bags of finish at
 * £11.50 each, 1 tub of primer at 27, I'll bring both" and `materials_supply`
 * recorded BOTH as customer_supplied. The drafter then rendered that faithfully
 * and the quote read "supplied by customer" on materials the contractor was
 * buying. The error was in the capture, so nothing downstream could catch it —
 * every layer below was working correctly on a wrong premise.
 *
 * WHAT IT WILL AND WILL NOT DO. It acts on EXPLICIT statements of supply and on
 * nothing else. "I'll bring/supply/buy/get/provide" is the contractor saying
 * they supply; "the customer will supply / is providing / already bought" is
 * the contractor saying they do not. Anything short of that leaves the captured
 * value alone.
 *
 * "I need eight bags" is the case that proves the rule, and it is deliberately
 * NOT a signal. A trade says "I need" about materials they are buying and about
 * materials being left on site for them, in the same breath and the same tone.
 * Turning it into ownership would be guessing with a rule instead of guessing
 * with a model, which is worse, because it would be consistent about it.
 *
 * This is enforceable, repeatable handling of what was said plainly. It is not
 * an understanding of every phrasing, and it is not meant to be: where the
 * words do not settle it, the captured value stands and the uncertainty
 * survives to the surfaces that can ask.
 */

/** The contractor saying they supply it. */
const CONTRACTOR_CLAIM =
  /\b(?:i(?:'| a)?m\s+(?:bringing|supplying|buying|getting|providing)|(?:i|we)(?:'ll| will|\s+shall)\s+(?:bring|supply|buy|get|provide|sort|pick\s+up|grab)|(?:i|we)\s+(?:bring|supply|buy|provide)\b|on\s+(?:me|us)\b|(?:i|we)(?:'ve| have)\s+(?:got|bought|ordered))/gi;

/** The contractor saying the customer supplies it. */
const CUSTOMER_CLAIM =
  /\b(?:(?:the\s+)?(?:customer|client|they|he|she)(?:'s|'ll| is| will| has| have| had)?\s+(?:supply|supplying|supplies|providing|provide|provides|bringing|bring|brings|buying|buy|bought|already\s+(?:bought|got|ordered)|getting|got|ordered)|supplied\s+by\s+(?:the\s+)?(?:customer|client)|customer[- ]supplied)/gi;

/**
 * Words that point back at materials already named rather than naming one.
 *
 * Split by number, because "it" and "both" do not reach the same distance. A
 * plural reaches every material last named; a singular claims ONE, so where two
 * were named it settles nothing and the captured value stands. "The customer is
 * supplying the finish and the primer, actually I'll bring it" is ambiguous to a
 * person too, and guessing there is exactly what this guard is not for.
 */
const ANAPHOR_PLURAL = /\b(?:both|them|those|these|all\s+of\s+(?:it|them)|the\s+lot|everything)\b/i;
const ANAPHOR_SINGULAR = /\b(?:it|that|the\s+one)\b/i;

/**
 * Words in a captured material entry that do not name the material.
 *
 * An entry is free text as the model wrote it — "6 bags of Finish at £11.50
 * each" — so the packaging, the count and the price have to come off before
 * what is left can be looked for in a sentence.
 */
const NOT_THE_MATERIAL =
  /\b(?:bags?|tubs?|tubes?|rolls?|boxes|box|packs?|sheets?|lengths?|litres?|kg|each|per|of|at|the|a|an|and|for|about|approx(?:imately)?|around|some|to|in|on|with|supplied|supply|by|customer|contractor|me|us|them|price|prices|priced)\b/gi;

/** The distinctive words of a captured entry: "6 bags of Finish at £11.50" -> ["finish"]. */
const materialKeywords = (entry: string): string[] =>
  entry
    .toLowerCase()
    .replace(/£\s*\d+(?:\.\d+)?/g, " ")
    .replace(/\d+(?:\.\d+)?/g, " ")
    .replace(NOT_THE_MATERIAL, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);

const mentions = (text: string, entry: string): boolean => {
  const keywords = materialKeywords(entry);
  if (keywords.length === 0) return false;
  const lower = text.toLowerCase();
  return keywords.some((word) => lower.includes(word));
};

export type OwnershipChange = {
  item: string;
  from: "contractor" | "customer";
  to: "contractor" | "customer";
  /** The words that settled it, so the change can be read back and argued with. */
  because: string;
};

export type ReconciledMaterialsSupply = {
  supply: MaterialsSupply;
  changes: OwnershipChange[];
};

type Claim = { at: number; owner: "contractor" | "customer"; text: string };

const claimsIn = (sentence: string): Claim[] => {
  const found: Claim[] = [];
  for (const [pattern, owner] of [
    [CONTRACTOR_CLAIM, "contractor"],
    [CUSTOMER_CLAIM, "customer"],
  ] as const) {
    pattern.lastIndex = 0;
    for (const match of sentence.matchAll(pattern)) {
      if (match.index === undefined) continue;
      found.push({ at: match.index, owner, text: match[0] });
    }
  }
  return found.sort((a, b) => a.at - b.at);
};

/**
 * Reconcile the captured supply against the transcript.
 *
 * Pure, and it only ever MOVES an item between the two lists — it never invents
 * a material, never drops one, and never touches an item the words do not name.
 * A later statement beats an earlier one, so a correction wins: "I'll supply the
 * finish, actually the customer already bought it" lands on the customer.
 */
export function reconcileMaterialsSupply(
  supply: MaterialsSupply | null | undefined,
  transcript: string | null | undefined,
): ReconciledMaterialsSupply {
  const empty = { contractor_supplied: [], customer_supplied: [] } as MaterialsSupply;
  if (!supply) return { supply: empty, changes: [] };
  if (!transcript || transcript.trim().length === 0) {
    return { supply, changes: [] };
  }

  const owned = new Map<string, "contractor" | "customer">();
  for (const item of supply.contractor_supplied) owned.set(item, "contractor");
  for (const item of supply.customer_supplied) owned.set(item, "customer");
  if (owned.size === 0) return { supply, changes: [] };

  const items = [...owned.keys()];
  // What the words settle, and the words that settled it. Last write wins,
  // which is how a correction beats the statement it corrects.
  const verdict = new Map<string, { owner: "contractor" | "customer"; because: string }>();

  // The materials named by the most recent sentence that named any, so an
  // anaphor can reach back past a sentence boundary: "The customer is supplying
  // the finish. Actually no, I'll bring it."
  let lastNamed: string[] = [];

  for (const sentence of splitIntoSentences(transcript)) {
    const namedHere = items.filter((item) => mentions(sentence, item));
    const claims = claimsIn(sentence);

    if (claims.length === 0) {
      if (namedHere.length > 0) lastNamed = namedHere;
      continue;
    }

    for (const [index, claim] of claims.entries()) {
      // A claim governs the words from itself to the next claim, so two claims
      // in one sentence do not fight over the same material.
      const until = claims[index + 1]?.at ?? sentence.length;
      const segment = sentence.slice(claim.at, until);

      let covered = items.filter((item) => mentions(segment, item));

      if (covered.length === 0) {
        // "I'll bring both" names nothing, so it reaches back: first to what
        // this sentence has already named, then to the last sentence that named
        // anything.
        const before = sentence.slice(0, claim.at);
        const reachBack = items.filter((item) => mentions(before, item));
        const target = reachBack.length > 0 ? reachBack : lastNamed;

        if (ANAPHOR_PLURAL.test(segment)) {
          covered = target;
        } else if (ANAPHOR_SINGULAR.test(segment) && target.length === 1) {
          covered = target;
        }
      }

      for (const item of covered) {
        verdict.set(item, { owner: claim.owner, because: claim.text.trim() });
      }
    }

    if (namedHere.length > 0) lastNamed = namedHere;
  }

  const changes: OwnershipChange[] = [];
  const contractor: string[] = [];
  const customer: string[] = [];

  for (const item of items) {
    const captured = owned.get(item)!;
    const settled = verdict.get(item);
    const owner = settled?.owner ?? captured;

    if (settled && settled.owner !== captured) {
      changes.push({ item, from: captured, to: settled.owner, because: settled.because });
    }
    (owner === "contractor" ? contractor : customer).push(item);
  }

  if (changes.length === 0) return { supply, changes: [] };

  return {
    supply: {
      ...supply,
      contractor_supplied: contractor,
      customer_supplied: customer,
      // Only restated because something moved, and only from what the lists now
      // say. Left alone entirely when nothing changed, so a captured value is
      // never overwritten by a derivation.
      responsibility:
        contractor.length > 0 && customer.length > 0
          ? "split"
          : contractor.length > 0
            ? "contractor"
            : "customer",
    },
    changes,
  };
}

/** One line per change, for the contractor to read back and disagree with. */
export const ownershipChangeFlag = (change: OwnershipChange): string =>
  `Materials supply corrected: "${change.item}" was recorded as ${change.from}-supplied, ` +
  `but you said "${change.because}" — it is now ${change.to}-supplied. ` +
  `Change it back on the line if that is wrong.`;
