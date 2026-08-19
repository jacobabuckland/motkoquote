// Guard vocabulary shared between the sendQuote server action and the quote
// editor that calls it.
//
// This lives outside `app/jobs/actions.ts` because that file carries the
// "use server" directive, and a server-actions module may only export async
// functions — a plain `const` export there does not merely fail, it makes the
// whole module resolve with NO exports at all, breaking every import of it.
// (tsc does not catch this; only the build does.)

/**
 * Thrown by sendQuote when a quote totals zero and carries no unresolved-rate
 * flag — i.e. the zero looks deliberate rather than missing.
 *
 * The client turns this into an inline confirmation and re-sends with
 * `confirmZeroTotal`. It is deliberately NOT a block: a goodwill callout or a
 * warranty visit is a legitimate £0 quote, and refusing to send one creates a
 * support problem that never arrives as a bug report.
 */
export const ZERO_TOTAL_CONFIRM_REQUIRED = "ZERO_TOTAL_CONFIRM_REQUIRED";

/**
 * The quote statuses during which a quote's figures may still be rewritten.
 *
 * A quote is editable while it is being prepared ('draft') or is out for a
 * decision ('sent'). Once the customer has accepted or declined, the figures
 * are agreed evidence: the contract's money panel reads `quotes.total` live at
 * view time, while its body prose carries the total frozen into
 * `variables_json` at signature. Rewriting the quote after that makes a signed
 * contract disagree with itself — panel and prose showing different figures
 * under an unchanged signature.
 *
 * Every action that writes `quotes.line_items_json` or `quotes.total` must
 * assert this both on the read AND in the UPDATE's own predicate, so an
 * acceptance landing between the two cannot be overwritten.
 */
export const EDITABLE_STATUSES = ["draft", "sent"] as const;

export type EditableStatus = (typeof EDITABLE_STATUSES)[number];

export const isEditableQuoteStatus = (status: string): status is EditableStatus =>
  (EDITABLE_STATUSES as readonly string[]).includes(status);

/**
 * The single refusal message for every blocked edit, so the three write paths
 * are indistinguishable to the contractor — they did the same thing and got
 * the same answer, whichever control they reached for.
 */
export const QUOTE_NOT_EDITABLE =
  "This quote can no longer be edited — the customer has already responded.";
