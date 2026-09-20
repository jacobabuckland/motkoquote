import { describeUnaskedSlot, isCustomerDetailSlot } from "@/lib/schemas/sow";
import type { Situation } from "@/lib/job-stages";

/**
 * While the quote is still the contractor's alone to change.
 *
 * `sow_json` is written once, at intake, and never reconciled against what the
 * job goes on to acquire — so this card kept asking for details the record had
 * long since answered. Reported 20 Sep against a job whose timeline read
 * captured / sent / accepted & signed / invoiced, still showing:
 *
 *     2 details are missing from this quote
 *       who supplies the materials
 *       what's been agreed on cost
 *
 * The quote carried a `Materials £210.00` line and was accepted at £1,740.00;
 * clause 4 of the signed contract reads "Materials will be supplied by:
 * Contractor". Both were answered, in documents the customer already holds.
 *
 * And the instruction was the dangerous part rather than the inaccuracy. "Tap
 * to review the quote and fill them in" leads to an editor that opens with
 * "Saving a change withdraws their acceptance and re-issues it" — so the
 * product sent a contractor to withdraw a signed customer's acceptance in
 * order to answer a question that was not open.
 *
 * So the card belongs to the window where its advice is free: a draft, or a
 * quote out for acceptance that can still be re-issued without cost. Once the
 * customer has committed, a gap in the intake record is history rather than a
 * task, and the quote editor's own warning is the right place to weigh it.
 *
 * A null situation means no quote has been derived yet, which is the draft
 * case and keeps the card.
 */
const quoteStillFreeToChange = (situation: Situation | null): boolean =>
  situation === null || situation === "draft_quote" || situation === "quote_sent";

/**
 * What a live intake did not come away with, said once.
 *
 * THIS USED TO BE TWO CARDS AND A CLAIM IT COULD NOT SUPPORT. Reported 12 Sep,
 * against a real job that showed both of them stacked:
 *
 *   "Call ended before who supplies the materials, what's been agreed on cost,
 *    the customer's name, contact details, the site address were captured"
 *   "The quote was drafted without it — tap to review and fill it in."
 *   "Call was cut short by a time or question limit"
 *
 * Four things wrong with that, and the first is the one that matters.
 *
 * 1. THE ATTRIBUTION WAS INVENTED. "Call ended before …" asserts the slots were
 *    missed because the call ended early. Nothing in the data says that. Every
 *    source feeding `unasked_required` is an ANSWEREDNESS test, not an
 *    asked-ness one: `wrapIncompleteSlotsRef` says so in its own comment
 *    ("Note what it is NOT: the set of slots we failed to ASK"), and
 *    `getMissingCustomerDetails` / `missingSiteAddress` are plain absence
 *    checks on the SoW. So the card was telling a trade they hung up too soon
 *    when the real cause was often that Motko never asked. Until N2.1 can tell
 *    the two apart, this states the FACT (these are missing) and no cause.
 * 2. The title concatenated slot names into a sentence, which reads fine at one
 *    and collapses at five. It is a list.
 * 3. The body said "without it" — singular, for however many there were.
 * 4. Two cards, same colour, same weight, one incident: double the alarm. They
 *    are independently true (a call can hit its cap having answered everything,
 *    and can end naturally with slots open), so this is not unconditionally one
 *    card — but when both hold they are one event, and the cap is a subordinate
 *    line inside the gaps card rather than a second alarm beside it.
 *
 * Amber is right and stays: the contractor owes an action (docs/design-rules.md
 * — "amber means your move"). The ink is not: the old card read `text-warning`,
 * which is `--amber` at 4.18:1 on `--amber-tint` and fails AA for body text.
 * Headings here use `--amber-ink` (5.91:1), per the same file.
 */
export function IncompleteCaptureCard({
  unaskedRequired,
  capEnded,
  href,
  situation = null,
}: {
  unaskedRequired: string[];
  capEnded: boolean;
  href: string;
  situation?: Situation | null;
}) {
  // Past acceptance this card's own instruction costs the contractor their
  // customer's signature. See quoteStillFreeToChange.
  if (!quoteStillFreeToChange(situation)) return null;

  // Filter out customer detail slots — those belong in the editor's "Before you
  // send" section where they can be fixed, not on the job page.
  const scopeSlots = unaskedRequired.filter((slot) => !isCustomerDetailSlot(slot));
  const missing = scopeSlots.map(describeUnaskedSlot);
  const one = missing.length === 1;

  if (missing.length === 0) {
    // The cap on its own. A real fact about how the call terminated — the one
    // flag here that IS evidence-backed — but with nothing missing it is a
    // prompt to read, not a warning of a gap.
    if (!capEnded) return null;
    return (
      <div className="flex flex-col gap-1 rounded-card border border-warning bg-warning-bg p-4">
        <span className="text-sm font-medium text-amber-ink">The call reached its limit</span>
        <span className="text-sm text-text-secondary">
          It ended on a limit rather than winding up naturally — worth reading the quote
          through before you send.
        </span>
      </div>
    );
  }

  return (
    <a
      href={href}
      className="flex flex-col gap-2 rounded-card border border-warning bg-warning-bg p-4"
    >
      <span className="text-sm font-medium text-amber-ink">
        {one ? "1 detail is missing from this quote" : `${missing.length} details are missing from this quote`}
      </span>
      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-text-secondary">
        {missing.map((label, i) => (
          <li key={i}>{label}</li>
        ))}
      </ul>
      <span className="text-sm text-text-secondary">
        Tap to review the quote and fill {one ? "it" : "them"} in.
      </span>
      {capEnded && (
        <span className="text-sm text-text-secondary">
          The call ended on its time or question limit, so it may not have got to
          everything.
        </span>
      )}
    </a>
  );
}
