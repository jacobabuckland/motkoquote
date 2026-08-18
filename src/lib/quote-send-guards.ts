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
