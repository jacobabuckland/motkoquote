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
  const amountPence = parseSpokenMoneyAmount(args.amount_words);
  if (amountPence === null || amountPence <= 0) {
    return { ok: false, error: amountUnparseablePrompt(args.amount_words) };
  }

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
      amountBasis: args.amount_basis ?? "unknown",
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
      ...splitOf(amountPence, args),
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
): { amountNet: number | null; vatAmount: number | null } {
  const vatWords = args.vat_amount_words;
  const statedVatPence =
    vatWords && vatWords.trim().length > 0 ? parseSpokenMoneyAmount(vatWords) : null;

  const resolved = resolveCostBasis({
    amountPence,
    basis: args.amount_basis ?? "unknown",
    treatment: args.vat_treatment ?? "unknown",
    statedVatPence,
  });

  return resolved.ok
    ? { amountNet: resolved.amountNet, vatAmount: resolved.vatAmount }
    : { amountNet: null, vatAmount: null };
}
