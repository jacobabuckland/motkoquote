import type { SowState } from "@/lib/schemas/sow";

/**
 * Customer details have no deterministic capture in voice intake.
 *
 * `ChecklistQuestionId` is `crew | duration | materials_supply | deadline |
 * agreed_costs`. `customer_name`, `site_address`, `customer_phone` and
 * `customer_email` exist in the SoW schema and in the `update_sow` tool, but
 * `maybeStartFollowups`, `concludeOrAskRequired` and the wrap detour are all
 * blind to them. Their entire enforcement is one sentence of prose at
 * character 5007 of a 7,680-character instruction string. That is instruction
 * dilution, not truncation — no truncation exists anywhere.
 *
 * **This module does not make the model ask.** Whether to add customer details
 * as a fourth forced checklist group depends on a measurement that has not been
 * taken: the original finding was measured on a looping call, where `update_sow`
 * never fired and the checklist phase was structurally unreachable. #369 fixed
 * the loop, so how much of the symptom survives is an open question, and the
 * 21 Aug "infer rather than interrogate" decision means three more forced
 * questions is not the safe default to reach for on an unmeasured premise.
 *
 * What holds either way is the ticket's one unconditional requirement: a call
 * that ends without a name or a contact channel must be **visible**, not
 * silently presenting a complete-looking quote. That is what this is.
 *
 * The send is already blocked without these (`sendBlockedReason` in the quote
 * editor), so this is not a new gate — it moves the discovery from the moment
 * the contractor tries to send to the moment they open the quote.
 */

export const CUSTOMER_DETAILS_FLAG_PREFIX = "Missing customer details:";

/**
 * A quote needs a name AND at least one way to reach the customer. The site
 * address is not included: a job whose address the contractor already knows is
 * ordinary, and flagging it would make the flag routine — at which point it
 * stops being read, which is the failure mode this exists to avoid.
 */
export const missingCustomerDetails = (sow: SowState | null): string[] => {
  if (!sow) return [];
  const missing: string[] = [];
  if (!sow.customer_name?.trim()) missing.push("name");
  // One channel is enough. Demanding both would flag the common case of a
  // customer who gave a mobile and no email.
  if (!sow.customer_phone?.trim() && !sow.customer_email?.trim()) {
    missing.push("a phone number or email");
  }
  return missing;
};

/**
 * The contractor-facing flag, or null when nothing is missing.
 *
 * Names what is absent rather than saying "incomplete", so the contractor can
 * tell at a glance whether it is the thing they already know (and can type in
 * seconds) or the thing they will have to ring the customer back for.
 */
export const customerDetailsFlag = (sow: SowState | null): string | null => {
  const missing = missingCustomerDetails(sow);
  if (missing.length === 0) return null;
  return (
    `${CUSTOMER_DETAILS_FLAG_PREFIX} ${missing.join(" and ")}. ` +
    `The quote can't be sent until these are filled in.`
  );
};

/**
 * Adds the flag to a flag list, replacing any earlier one so a redraft cannot
 * accumulate duplicates, and removing it entirely once the details are present.
 */
export const withCustomerDetailsFlag = (
  flags: string[] | null | undefined,
  sow: SowState | null,
): string[] => {
  const kept = (flags ?? []).filter(
    (flag) => !flag.startsWith(CUSTOMER_DETAILS_FLAG_PREFIX),
  );
  const flag = customerDetailsFlag(sow);
  return flag ? [...kept, flag] : kept;
};
