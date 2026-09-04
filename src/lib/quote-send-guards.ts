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

export const isEditableQuoteStatus = (
  status: string,
): status is EditableStatus =>
  (EDITABLE_STATUSES as readonly string[]).includes(status);

/**
 * The single refusal message for every blocked edit, so the three write paths
 * are indistinguishable to the contractor — they did the same thing and got
 * the same answer, whichever control they reached for.
 */
export const QUOTE_NOT_EDITABLE =
  "This quote can no longer be edited — the customer has already responded.";

/**
 * Thrown when a pricing-mode switch repriced the quote but could not record the
 * mode on the job.
 *
 * The two writes are separate statements with no transaction, and the quote one
 * runs first. So this failure leaves figures that were collapsed by a mode the
 * job has no record of — the same shape as the legacy `pricing: null` rows, and
 * previously it was swallowed entirely: the switch returned success while the
 * job page showed a mode nobody chose.
 *
 * Recoverable, which is why it names the retry: the job's `sow_json` is
 * unchanged, so running the switch again recomputes from the old mode and
 * rewrites the same quote.
 */
export const PRICING_MODE_NOT_RECORDED =
  "The quote was repriced but the pricing mode could not be saved. Try switching the mode again.";

/**
 * Thrown by sendQuote when the quote's own scope narrative states a price that
 * the priced figures do not support, or when the two stored fields holding the
 * agreed fixed price disagree with each other.
 *
 * The case this exists for: a quote whose Scope of work said the works were
 * "at a fixed price of £5,000" and whose single priced line read £5.00. Both
 * numbers went out on the same document. The total is what gets accepted and
 * paid against; the prose is what the customer believes they agreed. Whichever
 * way that dispute lands, the trade loses, and the document is the evidence.
 *
 * Like ZERO_TOTAL_CONFIRM_REQUIRED this is a confirmation, never a block — a
 * narrative may legitimately name a figure the priced total does not equal, and
 * refusing to send would be worse than asking.
 */
export const NARRATIVE_TOTAL_CONFIRM_REQUIRED =
  "NARRATIVE_TOTAL_CONFIRM_REQUIRED";

/** Amounts agreeing to within a penny are the same amount. */
const PENNY = 0.01;

/**
 * Every £ amount stated in a piece of prose, in the order written.
 *
 * Deliberately only matches a £ sign. The narrative is generated prose and
 * writes money with the symbol; a bare "5" in "5 sockets" or "5 days" is not an
 * amount, and treating it as one would fire this guard on ordinary quotes. The
 * guard must never fire on absence, so under-matching is the safe direction.
 *
 * The comma has to be inside the digit run rather than matched separately:
 * `£([\d.]+)` reads "£5,000" as five pounds, which is precisely the confusion
 * this guard exists to catch and would make it blind to its own defect.
 */
export const narrativeAmounts = (
  narrative: string | null | undefined,
): number[] => {
  if (!narrative) return [];
  const found: number[] = [];
  for (const match of narrative.matchAll(/£\s?([\d,]+(?:\.\d+)?)/g)) {
    const value = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(value)) found.push(value);
  }
  return found;
};

export type NarrativeTotalCheck = {
  /** The narrative figure that disagrees, or null when nothing disagrees. */
  statedAmount: number | null;
  /** The priced net figure it was compared against. */
  subtotal: number;
  /** True when the contractor should be asked before this sends. */
  confirmRequired: boolean;
};

/**
 * Does the scope narrative promise a bigger number than the quote charges?
 *
 * Compared against the NET subtotal, not the VAT-inclusive total. A narrative
 * saying £5,000 on a VAT-registered £6,000 quote is correct, and comparing
 * against the total would fire on every VAT-registered quote that states its
 * price in prose — which is most of them.
 *
 * Only an amount ABOVE the subtotal counts. A narrative naming a figure BELOW
 * it is the ordinary case and not a signal: sub-part prices, day rates,
 * provisional sums and deposits are all smaller than the job by definition, so
 * flagging them would bury the real divergence in noise. A sub-part price can
 * never exceed the job total, so the largest figure in the prose being bigger
 * than what is being charged is the shape that is actually wrong.
 */
export const narrativeExceedsSubtotal = (
  narrative: string | null | undefined,
  subtotal: number,
): NarrativeTotalCheck => {
  const amounts = narrativeAmounts(narrative);
  if (amounts.length === 0) {
    return { statedAmount: null, subtotal, confirmRequired: false };
  }
  const highest = Math.max(...amounts);
  if (highest - subtotal <= PENNY) {
    return { statedAmount: null, subtotal, confirmRequired: false };
  }
  return { statedAmount: highest, subtotal, confirmRequired: true };
};

/**
 * The same agreed price is stored in two independent fields —
 * `agreed_costs.fixed_price` ("Agreed fixed/total price in GBP, if stated") and
 * `pricing.fixed_amount` ("the single total price... for the whole job"). Only
 * the second reaches the customer: applyPricingMode reads `pricing` and the
 * type narrows `agreed_costs` out entirely, so the function that decides what a
 * customer will be held to cannot see that the other stored figure for the same
 * job disagrees with it.
 *
 * Two fields for one concept is the underlying defect and collapsing them is a
 * separate, larger change. Until then this at least notices.
 *
 * Returns false when either is absent: a job that only ever populated one field
 * has nothing to disagree with, and that is the common case.
 */
export const agreedPriceDisagrees = (
  agreedFixedPrice: number | null | undefined,
  pricingFixedAmount: number | null | undefined,
): boolean => {
  if (agreedFixedPrice == null || pricingFixedAmount == null) return false;
  return Math.abs(agreedFixedPrice - pricingFixedAmount) > PENNY;
};

/**
 * Carries the two disagreeing figures back to the client on the sentinel.
 *
 * A bare "these don't match" is not worth interrupting a send for: the whole
 * value of the question is that the contractor sees BOTH numbers and can tell
 * at a glance which one is wrong. The server has them and the editor does not
 * (it never reads the scope narrative), so they travel on the message.
 *
 * `stated` is null when the divergence came from the two stored price fields
 * rather than from the prose — there is no narrative figure to show.
 */
export const narrativeConfirmMessage = (
  stated: number | null,
  subtotal: number,
): string => `${NARRATIVE_TOTAL_CONFIRM_REQUIRED}:${stated ?? ""}:${subtotal}`;

export type NarrativeConfirmDetail = {
  stated: number | null;
  subtotal: number | null;
};

/**
 * Reads the figures back off a thrown message. Returns null when the message is
 * not this sentinel, so the caller can use it as the test as well as the parse.
 *
 * Tolerates a message with no figures appended: a sentinel that arrives bare
 * (an older client, a rethrow that lost the tail) must still be recognised as
 * the confirmation question rather than surfacing as a raw error string.
 */
export const parseNarrativeConfirm = (
  message: string,
): NarrativeConfirmDetail | null => {
  if (!message.includes(NARRATIVE_TOTAL_CONFIRM_REQUIRED)) return null;
  const match = message.match(
    new RegExp(`${NARRATIVE_TOTAL_CONFIRM_REQUIRED}:([^:]*):([^:\\s]*)`),
  );
  if (!match) return { stated: null, subtotal: null };
  const stated = match[1] === "" ? null : Number(match[1]);
  const subtotal = match[2] === "" ? null : Number(match[2]);
  return {
    stated: stated != null && Number.isFinite(stated) ? stated : null,
    subtotal: subtotal != null && Number.isFinite(subtotal) ? subtotal : null,
  };
};
