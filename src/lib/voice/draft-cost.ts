import type { DraftedCost } from "@/components/voice/cost-intake-adapter";
import { parseSpokenMoneyAmount } from "@/lib/parse-spoken-money";

/**
 * Turns the model's `draft_cost` tool arguments into a cost draft.
 *
 * Money integrity (LED-5, #258): the model supplies the contractor's words,
 * never a figure. The amount is computed here by deterministic code, so the
 * number shown for confirmation — and therefore the number that can reach the
 * ledger — is one this codebase derived, not one a model asserted.
 *
 * Pure: no network, no clock, no randomness. `today` is passed in for that
 * reason.
 */

export type DraftCostToolArgs = {
  amount_words?: string;
  counterparty_name?: string | null;
  category?: "materials" | "labour" | "subcontractor" | "plant_hire" | "other";
  job_id?: string;
  job_display?: string;
  description?: string;
};

export type DraftCostOutcome =
  | { ok: true; draft: DraftedCost }
  | { ok: false; error: string };

export const amountUnparseablePrompt = (words: string): string =>
  `Could not parse amount from '${words}'. Please ask the contractor for the ` +
  "amount again, more clearly.";

export function buildDraftFromToolArgs(
  args: DraftCostToolArgs,
  today: string,
): DraftCostOutcome {
  if (!args.amount_words || !args.job_id || !args.description) {
    return {
      ok: false,
      error: "Missing required fields: amount_words, job_id, or description",
    };
  }

  // An unparseable phrase means no deterministic amount exists. There is no
  // model-supplied figure to fall back to, by design — the model is sent back
  // to ask, per the spec's rule that ambiguity asks rather than assumes.
  const amountPence = parseSpokenMoneyAmount(args.amount_words);
  if (amountPence === null || amountPence <= 0) {
    return { ok: false, error: amountUnparseablePrompt(args.amount_words) };
  }

  return {
    ok: true,
    draft: {
      amountPence,
      amountWords: args.amount_words,
      counterpartyName: args.counterparty_name ?? null,
      category: args.category ?? "other",
      jobId: args.job_id,
      jobDisplay: args.job_display ?? "",
      incurredOn: today,
      description: args.description,
    },
  };
}
