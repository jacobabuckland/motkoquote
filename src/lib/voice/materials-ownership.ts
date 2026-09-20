import type { MaterialsSupply } from "@/lib/schemas/job";
import { contractorSaid } from "@/lib/voice/contractor-said";
import { statedCustomerPrices } from "@/lib/voice/customer-price-idiom";
import { splitIntoSentences } from "@/lib/voice/stated-prices";
import type { TranscriptTurn } from "@/lib/voice-transcript";

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
// The trailing \b on the verb group is load-bearing. JS alternation takes the
// FIRST branch that matches, so `supply|supplying` matched "supply" inside
// "supplying" and the claim came out as "The customer is supply" -- three
// letters short. The itemised path never saw it, because it slices from the
// claim's START; the whole-job path slices from its END and read "ing the
// materials", which no object matches. It was also what the contractor was
// quoted as having said, in the flag asking them to check it.
const CUSTOMER_CLAIM =
  /\b(?:(?:the\s+)?(?:customer|client|they|he|she)(?:'s|'ll| is| will| has| have| had)?\s+(?:supply|supplying|supplies|providing|provide|provides|bringing|bring|brings|buying|buy|bought|already\s+(?:bought|got|ordered)|getting|got|ordered)\b|supplied\s+by\s+(?:the\s+)?(?:customer|client)|customer[- ]supplied)/gi;

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

/**
 * The contractor said two things that cannot both be true, and neither is
 * safely actionable, so the question is handed back rather than answered.
 */
export type OwnershipConflict = {
  /** The explicit statement of supply, verbatim. */
  supplyClaim: string;
  /** The pricing idiom that contradicts it, verbatim. */
  pricingClaim: string;
};

export type ReconciledMaterialsSupply = {
  supply: MaterialsSupply;
  changes: OwnershipChange[];
  /**
   * Contradictions left standing. The captured value is UNCHANGED on every one
   * of these — a conflict is a reason to ask, never a reason to pick a side.
   */
  unresolved: OwnershipConflict[];
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
 * Ownership for a job that itemised nothing, where `responsibility` carries it.
 *
 * Deliberately stricter than the itemised path. There, a claim is matched to
 * the material it names and only that material moves; here there is no material
 * to name, so a claim moves EVERYTHING. That is a bigger move on weaker
 * evidence, so it needs a clearer statement:
 *
 *  - the claim must reach the whole job, not one thing in it. "I'll bring the
 *    finish" says nothing about the primer, and with nothing itemised there is
 *    no way to say so -- it is left alone.
 *  - the last such claim wins, as everywhere else, so a correction beats what
 *    it corrects.
 *
 * Unanimity does the work: where every whole-job claim in the call agrees, that
 * is the answer. Where they disagree the LAST one stands, which is the same
 * rule #826 set for an itemised correction.
 */
/**
 * A whole-job object, and it must be what the claim VERB takes.
 *
 * Anchored to the start of what follows the claim, which is the whole guard.
 * "On me" is a claim about whatever came before it -- a skip, parking, waste
 * removal -- and matching a whole-job word anywhere after it reads three
 * ordinary sentences as the contractor buying every material on the job:
 *
 *   "Waste removal is on me and no other materials are needed."
 *   "The skip is on me, the customer has all the materials already."
 *   "Parking is on me for all of it."
 *
 * The second is the one that matters: it says the CUSTOMER has the materials,
 * and an unanchored read flipped it to contractor on a claim about the skip.
 *
 * The cost of anchoring is "all the materials are on me", where the object
 * comes first. That is left alone, which is the safe direction: the captured
 * value stands and the contractor is not told something they did not say.
 */
const WHOLE_JOB_FOLLOWS =
  /^[\s,]*(?:all\s+(?:of\s+)?(?:it|them|the\s+lot|the\s+materials?)?|everything|the\s+lot|both|them|those|the\s+materials?|materials?)\b/i;

const reconcileWholeJob = (
  supply: MaterialsSupply,
  said: string,
  /** The pricing idiom, already cleared of any explicit claim that outranks it. */
  usableIdiom: string | null,
): ReconciledMaterialsSupply => {
  const captured = supply.responsibility;
  // Nothing captured is not a wrong capture -- it is an unanswered question,
  // and inventing an answer here is what this module exists not to do.
  if (captured !== "contractor" && captured !== "customer") {
    return { supply, changes: [], unresolved: [] };
  }

  let settled: { owner: "contractor" | "customer"; because: string } | null = null;
  for (const sentence of splitIntoSentences(said)) {
    for (const claim of claimsIn(sentence)) {
      // Only a claim whose own object is the whole job.
      const after = sentence.slice(claim.at + claim.text.length);
      if (!WHOLE_JOB_FOLLOWS.test(after)) continue;
      settled = { owner: claim.owner, because: claim.text.trim() };
    }
  }

  // THE PRICING IDIOM, AND ONLY WHERE THE WORDS SETTLED NOTHING.
  //
  // "These are customer prices" is what mis-captured scenario 41, and it is a
  // statement about the SELL price: a contractor quoting one for a material is
  // charging for it. That makes it evidence, but weak evidence beside a plain
  // statement of supply, so it is consulted last and under three conditions:
  //
  //  - nothing explicit settled the job. A contractor who said who buys has
  //    been answered already, and an idiom does not get to overrule them.
  //  - the capture says CUSTOMER. Going the other way is the unsafe direction
  //    -- it would put materials on the quote that nobody said were the
  //    contractor's -- and there is nothing to correct when the capture
  //    already agrees.
  //  - the contractor never said the customer supplies, ANYWHERE in the call.
  //    That check is made by the caller, which can see the whole thing, and it
  //    is why this takes `said` rather than deciding on one sentence.
  //
  // The move is surfaced with the words that made it, like every other, so a
  // contractor for whom this reads wrong can say so on the line.
  if (settled === null && captured === "customer" && usableIdiom !== null) {
    settled = { owner: "contractor", because: usableIdiom };
  }

  if (settled === null || settled.owner === captured) {
    return { supply, changes: [], unresolved: [] };
  }

  return {
    supply: { ...supply, responsibility: settled.owner },
    changes: [
      { item: "the materials", from: captured, to: settled.owner, because: settled.because },
    ],
    unresolved: [],
  };
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
  turns?: TranscriptTurn[] | null,
): ReconciledMaterialsSupply {
  const empty = { contractor_supplied: [], customer_supplied: [] } as MaterialsSupply;
  if (!supply) return { supply: empty, changes: [], unresolved: [] };

  // ONLY THE CONTRACTOR'S HALF OF THE CALL.
  //
  // Every claim below is read as the contractor's own statement, and the
  // assistant says these words too: "so the customer's supplying the tiles?"
  // read whole is a customer claim in Motko's mouth, and it would move who pays
  // for the materials. Falls back to the flat transcript when turns are absent
  // or legacy, which is how every other reader behaves on the same input.
  const said = contractorSaid(transcript, turns);
  if (said.trim().length === 0) {
    return { supply, changes: [], unresolved: [] };
  }

  // A plain statement of supply outranks the pricing idiom, always. Where the
  // contractor said both, neither is acted on and the contradiction is handed
  // back: "the customer's buying the bags, these are customer prices" is a
  // sentence a person would query, and picking a side of it is guessing with
  // the customer's money in either direction.
  const idiom = statedCustomerPrices(said);
  CUSTOMER_CLAIM.lastIndex = 0;
  // The LAST customer claim, so a correction is what gets quoted back, the same
  // rule the itemised path applies to a claim that supersedes an earlier one.
  const contradicting =
    idiom === null ? undefined : [...said.matchAll(CUSTOMER_CLAIM)].at(-1);
  CUSTOMER_CLAIM.lastIndex = 0;
  const unresolved: OwnershipConflict[] =
    idiom !== null && contradicting !== undefined
      ? [{ supplyClaim: contradicting[0].trim(), pricingClaim: idiom }]
      : [];
  const usableIdiom = unresolved.length > 0 ? null : idiom;

  const owned = new Map<string, "contractor" | "customer">();
  for (const item of supply.contractor_supplied) owned.set(item, "contractor");
  for (const item of supply.customer_supplied) owned.set(item, "customer");

  // THE ARRAYS ARE THE EXCEPTION. `responsibility` IS THE ANSWER.
  //
  // This used to stop here when both lists were empty, which is most jobs: the
  // intake schema says in as many words to itemise "on a SPLIT only" and to
  // leave the arrays empty otherwise. So the guard built to catch wrong
  // ownership capture was inert on every job that was not a split -- including
  // a contractor saying "I'll bring all the materials myself" over a captured
  // `responsibility: "customer"`, which is the exact shape it exists for.
  //
  // With nothing itemised there is no item to move, so the whole job moves or
  // nothing does: a claim that names no material is a claim about the lot.
  if (owned.size === 0) {
    return { ...reconcileWholeJob(supply, said, usableIdiom), unresolved };
  }

  const items = [...owned.keys()];
  // What the words settle, and the words that settled it. Last write wins,
  // which is how a correction beats the statement it corrects.
  const verdict = new Map<string, { owner: "contractor" | "customer"; because: string }>();

  // The materials named by the most recent sentence that named any, so an
  // anaphor can reach back past a sentence boundary: "The customer is supplying
  // the finish. Actually no, I'll bring it."
  let lastNamed: string[] = [];

  for (const sentence of splitIntoSentences(said)) {
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

  if (changes.length === 0) return { supply, changes: [], unresolved };

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
    unresolved,
  };
}

/**
 * One line per contradiction, asking rather than deciding.
 *
 * It names both halves in the contractor's own words, because the two readings
 * are worth different money and the person who knows which is right is the one
 * reading the flag. Nothing was changed on their behalf.
 */
export const ownershipConflictFlag = (conflict: OwnershipConflict): string =>
  `Who buys the materials is unclear: you said "${conflict.supplyClaim}", ` +
  `and also "${conflict.pricingClaim}". ` +
  `A customer price is what the customer is charged, which usually means you are ` +
  `supplying — check the materials on this quote before you send it.`;

/** One line per change, for the contractor to read back and disagree with. */
export const ownershipChangeFlag = (change: OwnershipChange): string =>
  `Materials supply corrected: "${change.item}" was recorded as ${change.from}-supplied, ` +
  `but you said "${change.because}" — it is now ${change.to}-supplied. ` +
  `Change it back on the line if that is wrong.`;
