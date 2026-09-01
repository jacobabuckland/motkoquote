import type { DraftedCost } from "@/components/voice/cost-intake-adapter";
import { matchJobBySpokenReference, type JobSummary } from "@/lib/match-job";
import { parseSpokenMoneyAmount } from "@/lib/parse-spoken-money";

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
      incurredOn: today,
      description: args.description,
    },
  };
}
