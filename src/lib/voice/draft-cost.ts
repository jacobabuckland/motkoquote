import type { DraftedCost } from "@/components/voice/cost-intake-adapter";
import { matchJobBySpokenReference, type JobSummary } from "@/lib/match-job";
import { parseSpokenMoneyAmount } from "@/lib/parse-spoken-money";
import { resolveCostBasis } from "@/lib/cost-vat-basis";
import { resolveSpokenDate } from "@/lib/voice/spoken-date";

/**
 * Turns the model's `draft_cost` tool arguments into a cost draft.
 *
 * Money integrity (LED-5, #258): the model supplies the contractor's words,
 * never a figure. The amount is computed here by deterministic code, so the
 * number shown for confirmation — and therefore the number that can reach the
 * ledger — is one this codebase derived, not one a model asserted.
 *
 * Job integrity (#274): the same rule, one field over. The model used to supply
 * `job_id`, picked from a list in the prompt, and the only downstream check was
 * that the job BELONGED to the contractor — never that it was the one they
 * meant. Two "Smith" jobs and "the Smith job" resolved to whichever the model
 * liked and the cost landed on the wrong job's P&L in silence, which LED-2 and
 * LED-4 would then report confidently.
 *
 * `matchJobBySpokenReference` had 22 tests and no callers. It is now the only
 * way a job id is produced here, and its "ambiguous" verdict sends the model
 * back to ask rather than resolving to a guess.
 *
 * Pure: no network, no clock, no randomness. `today` is passed in for that
 * reason.
 */

export type DraftCostToolArgs = {
  amount_words?: string;
  counterparty_name?: string | null;
  category?: "materials" | "labour" | "subcontractor" | "plant_hire" | "other";
  /** The contractor's own words for the job. Never an id — see the header. */
  job_spoken_words?: string;
  description?: string;
  // Reported, never computed: the model says what it heard and the arithmetic
  // happens in cost-vat-basis.ts, exactly as amount_words is parsed rather
  // than converted by the model.
  amount_basis?: "net" | "gross" | "unknown";
  vat_amount_words?: string | null;
  vat_treatment?: "standard" | "zero" | "exempt" | "reverse_charge" | "unknown";
  paid?: boolean | null;
  /** WHEN, in the contractor's words. Resolved by code, never by the model. */
  incurred_on_words?: string | null;
};

export type DraftCostOutcome =
  | { ok: true; draft: DraftedCost }
  | { ok: false; error: string };

/**
 * An amount phrase says two things at once, and the parser only wanted one.
 *
 * `draft_cost` is told to report the contractor's WORDS, so `amount_words`
 * arrives as they said it -- "GBP 60 including VAT", "GBP 36 total". Every one of
 * those parses to null, because the qualifier is not part of the number, and a
 * null amount refuses the capture and sends the assistant back to ask. It asks
 * again, the contractor says the same true sentence again, and the loop is the
 * failure: runs 106 and 109 of the 17 Sep tranche ended after four and five
 * follow-ups with NO cost saved at all. Not a wrong figure -- no record.
 *
 * So the qualifier is removed before parsing, and read rather than discarded:
 * "including VAT" is the contractor telling us the basis, and it is better
 * evidence than the nothing we have when the model omits `amount_basis`.
 *
 * Deliberately narrow in what it infers. A basis is taken ONLY where VAT is
 * named outright; a bare "total" or "altogether" is stripped so the number can
 * parse and the basis is left exactly as the model gave it -- unknown, if that
 * is what it gave, so the server refuses and the assistant asks which it was.
 * "Total" does not mean "including VAT" in every trade's mouth, and guessing it
 * would move the net figure on a real cost record. The rule is the one the
 * ambiguous-basis refusal already states: ask rather than assume.
 *
 * Confined to the cost path on purpose. `parseSpokenMoneyAmount` is shared with
 * quote extraction, which has its own qualifier vocabulary, and widening it
 * there would reach every stated price in the app.
 */
const VAT_INCLUSIVE =
  /\b(?:incl?(?:uding|usive)?\.?\s*(?:of\s+)?vat|inc\.?\s*vat|with\s+vat|gross)\b/i;
const VAT_EXCLUSIVE =
  /\b(?:plus\s+vat|\+\s*vat|ex(?:cl(?:uding|usive)?)?\.?\s*(?:of\s+)?vat|before\s+vat|nett?)\b/i;

/** Everything above, plus the bare totalisers, removed so the number parses. */
const AMOUNT_QUALIFIER =
  /\b(?:incl?(?:uding|usive)?\.?\s*(?:of\s+)?vat|inc\.?\s*vat|with\s+vat|plus\s+vat|\+\s*vat|ex(?:cl(?:uding|usive)?)?\.?\s*(?:of\s+)?vat|before\s+vat|gross|nett?|in\s+total|all\s+in|altogether|total)\b/gi;

export type AmountPhraseReading = {
  pence: number | null;
  /** Null where the words name no basis -- never a guess. */
  basis: "net" | "gross" | null;
};

export function readAmountPhrase(words: string): AmountPhraseReading {
  const basis = VAT_INCLUSIVE.test(words)
    ? ("gross" as const)
    : VAT_EXCLUSIVE.test(words)
      ? ("net" as const)
      : null;

  const stripped = words.replace(AMOUNT_QUALIFIER, " ").replace(/\s+/g, " ").trim();
  // Strip nothing away and you get the same phrase back, so an amount that
  // already parsed still takes the identical path it always did.
  const pence = parseSpokenMoneyAmount(stripped.length > 0 ? stripped : words);

  return { pence, basis };
}

export const amountUnparseablePrompt = (words: string): string =>
  `Could not parse amount from '${words}'. Please ask the contractor for the ` +
  "amount again, more clearly.";

/**
 * Two different failures, two different things to say.
 *
 * "No job matched" and "several jobs matched" need opposite follow-up
 * questions, and collapsing them into one message is how an agent ends up
 * asking a contractor to repeat a name it heard perfectly well.
 */
export const jobAmbiguousPrompt = (words: string): string =>
  `More than one job matches '${words}'. Ask which one they mean — the customer ` +
  "name on its own is not enough here, so ask for something that separates them.";

export const jobUnmatchedPrompt = (words: string): string =>
  `No job matches '${words}'. Ask the contractor which job this cost is for, ` +
  "by customer name.";

export function buildDraftFromToolArgs(
  args: DraftCostToolArgs,
  today: string,
  jobs: JobSummary[],
): DraftCostOutcome {
  if (!args.amount_words || !args.job_spoken_words || !args.description) {
    return {
      ok: false,
      error:
        "Missing required fields: amount_words, job_spoken_words, or description",
    };
  }

  // An unparseable phrase means no deterministic amount exists. There is no
  // model-supplied figure to fall back to, by design — the model is sent back
  // to ask, per the spec's rule that ambiguity asks rather than assumes.
  const { pence: amountPence, basis: basisFromWords } = readAmountPhrase(args.amount_words);
  if (amountPence === null || amountPence <= 0) {
    return { ok: false, error: amountUnparseablePrompt(args.amount_words) };
  }

  // What the model REPORTED wins; the contractor's words only fill a gap it
  // left. A model that says "net" while the words say "including VAT" is a
  // disagreement, and overriding its report here would hide it -- the basis it
  // reports is the field built for this and stays the authority.
  const effectiveBasis =
    args.amount_basis && args.amount_basis !== "unknown"
      ? args.amount_basis
      : (basisFromWords ?? "unknown");

  // The job is MATCHED, never accepted. "ambiguous" is the verdict this exists
  // for: it is a real answer, not a failure to find one, and resolving it to a
  // guess is precisely the defect.
  const match = matchJobBySpokenReference(args.job_spoken_words, jobs);
  if (match === "ambiguous") {
    return { ok: false, error: jobAmbiguousPrompt(args.job_spoken_words) };
  }
  if (match === null) {
    return { ok: false, error: jobUnmatchedPrompt(args.job_spoken_words) };
  }

  return {
    ok: true,
    draft: {
      amountPence,
      amountWords: args.amount_words,
      counterpartyName: args.counterparty_name ?? null,
      category: args.category ?? "other",
      jobId: match.id,
      jobDisplay: match.customer_name,
      // The day they SAID, where they said one. `today` is the fallback, not
      // the answer — see src/lib/voice/spoken-date.ts.
      incurredOn: resolveSpokenDate(args.incurred_on_words, today) ?? today,
      description: args.description,
      // Absent means "the model did not say", which is the same as the
      // contractor not having said — and both land on the honest answer
      // rather than a confident wrong one.
      amountBasis: effectiveBasis,
      vatAmountWords: args.vat_amount_words ?? null,
      vatTreatment: args.vat_treatment ?? "unknown",
      paid: args.paid ?? null,
      // THE SPLIT, RESOLVED ONCE.
      //
      // `completeCostCapture` re-derives this server-side and that stays the
      // authority — the client sends intent, never state. Resolving it here as
      // well is what lets the confirmation screen SHOW the net and the VAT
      // before the contractor taps save, and what lets the Edit button hand the
      // form the same two numbers instead of the gross figure.
      //
      // Null when the basis is genuinely ambiguous. The server refuses that
      // case and the assistant asks, exactly as before; nothing here decides it.
      ...splitOf(amountPence, args, effectiveBasis),
    },
  };
}

/**
 * Net and VAT for the draft, or nulls where the basis does not settle them.
 *
 * Deliberately the same call the server makes, from the same module, so the
 * figure shown for confirmation and the figure written cannot disagree.
 */
function splitOf(
  amountPence: number,
  args: DraftCostToolArgs,
  basis: "net" | "gross" | "unknown",
): { amountNet: number | null; vatAmount: number | null } {
  const vatWords = args.vat_amount_words;
  const statedVatPence =
    vatWords && vatWords.trim().length > 0 ? parseSpokenMoneyAmount(vatWords) : null;

  const resolved = resolveCostBasis({
    amountPence,
    basis,
    treatment: args.vat_treatment ?? "unknown",
    statedVatPence,
  });

  return resolved.ok
    ? { amountNet: resolved.amountNet, vatAmount: resolved.vatAmount }
    : { amountNet: null, vatAmount: null };
}
