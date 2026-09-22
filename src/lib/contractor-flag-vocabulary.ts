/**
 * A private note to a tradesperson, written in a tradesperson's words.
 *
 * `contractor_flags` is `z.array(z.string())` authored by the drafting model
 * and rendered verbatim in the editor's "Before you send" panel. There is no
 * content constraint on it and no step between the model and the screen, so on
 * 21 Sep a plasterer's quote carried:
 *
 *     The £48 delivery has a locked price applied in code. The £65 delivery
 *     has been estimated at 6500p
 *
 * Neither phrase is written anywhere in this app. The model read
 * `estimated_unit_cost_pence` off its own draft and "the locked prices will be
 * applied in code" out of its own system prompt, and handed both back to the
 * contractor.
 *
 * THE RULE, AND WHY IT IS A DROP RATHER THAN A REWRITE. A flag that names the
 * machinery is the app talking to itself in front of the contractor. It is
 * never actionable, because every mechanical fact it can state — this line is
 * unpriced, this price came from what you said, this figure is ours and is not
 * charged — is already stated properly by a deterministic flag beside it, in
 * pounds, with the words to fix it. Normalising `6500p` to `£65.00` would
 * leave "The £65 delivery has been estimated at £65.00", which is still not a
 * note to anybody. So the whole flag goes.
 *
 * It applies to MODEL output only, at `parseQuoteDraft` — the single boundary
 * where a drafting response becomes app data. The app's own flags are written
 * deliberately and are not filtered; a marker below that one of them happened
 * to trip would silence a guard, which is the opposite of the point.
 */

/**
 * Marks that appear in a machine's description of its own working and never in
 * a note a trade would write. Each is narrow on purpose: this drops a whole
 * flag, so a false positive costs the contractor something they needed.
 */
const MACHINERY = [
  // A pence amount of £1 or more. `6500p` is a field value; `50p` is money a
  // person really writes, so the cut is at three digits rather than at "p".
  /\b\d{3,}p\b/,
  // An identifier. estimated_unit_cost_pence, rate_card_id, supplied_by — and
  // whatever the next revision of the prompt names, without having to list it.
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/,
  // The app describing where the work happens rather than what the contractor
  // should do. "applied in code" came straight out of the system prompt.
  /\bin code\b/i,
  /\block(?:ed)? pric(?:e|es|ing)\b/i,
  // Our own validator's word for it. See stated-price-guard.ts, which no
  // longer says this either.
  /\bprovenance\b/i,
] as const;

/** True when this reads as the app describing its own working. */
export const namesTheMachinery = (flag: string): boolean =>
  MACHINERY.some((marker) => marker.test(flag));

/**
 * Model-authored flags, less the ones addressed to the app rather than to the
 * contractor. Order is preserved: the panel reads top to bottom and the model
 * puts the thing it thinks most important first.
 */
export const keepContractorFlags = (flags: string[]): string[] =>
  flags.filter((flag) => !namesTheMachinery(flag));
