import { EDITABLE_STATUSES, QUOTE_NOT_EDITABLE } from "@/lib/quote-send-guards";

/**
 * Whether a quote may be rewritten, and whether rewriting it re-issues.
 *
 * THE RULE IS NOT EXPRESSIBLE AS A STATUS LIST, which is the whole shape of
 * #727 and the reason this exists beside `isEditableQuoteStatus` rather than
 * replacing it. Jacob's ruling, 13 Sep:
 *
 *   1. An edit voids the acceptance, and only up to the point of the contract.
 *      Once a contract exists the quote is not editable at all — signed or
 *      unsigned.
 *   2. A re-issued quote must be accepted again.
 *
 * So `accepted` with no contract is editable and `accepted` with a contract is
 * not: two quotes with the same status and different answers. A status filter
 * alone cannot decide it.
 *
 * `reissues` is the second question, and it is separate on purpose. Editing a
 * draft changes a document nobody has agreed to. Editing an ACCEPTED quote
 * withdraws an agreement, and three things follow mechanically (see the card):
 * `accepted_at` is cleared, `sent_total` is updated so the divergence notice
 * does not then fire permanently on the re-issued quote, and the customer is
 * told. A caller that reads `editable` and ignores `reissues` silently
 * overwrites an agreement and tells nobody — which is the failure this item
 * exists to prevent, not a lesser version of it.
 */
export type QuoteEditability =
  | { editable: true; reissues: boolean }
  | { editable: false; reissues: false; reason: string };

/**
 * A contract exists for this quote. `contracts.quote_id` is UNIQUE, so this is
 * a to-ONE embed and comes back as an object or null — NOT an array.
 *
 * Reading it with `Boolean(...)` on a to-MANY embed is how the fourth
 * derivation of this item broke: PostgREST returns `[]` for a to-many with no
 * rows, `Boolean([])` is `true`, and the guard would then have read "a contract
 * exists" on every job in production — freezing every accepted quote, the exact
 * opposite of decision (1), while the type annotation still said
 * `{ id: string } | null`. Hence an explicit helper rather than a truthiness
 * check at each call site.
 */
export const hasContract = (contract: { id: string } | { id: string }[] | null | undefined): boolean => {
  if (!contract) return false;
  if (Array.isArray(contract)) return contract.length > 0;
  return true;
};

/** Refusal when a contract exists. Distinct from the already-responded case. */
/**
 * Contract statuses that stop blocking the quote they came from.
 *
 * `withdrawn` is CONTRACT-1's: the contractor took it back, so the quote
 * re-opens and they can correct it.
 *
 * `declined` is pass-12 SERIOUS 4, and it is the same situation arrived at from
 * the other side. The CUSTOMER refused the contract, and a contract nobody
 * agreed to was freezing the quote for ever: the job read "Nothing needs you
 * here", the only controls were copy-link, download and archive, and a customer
 * who declined because a date was wrong had ended the job permanently. The
 * contractor's sole exit was to archive it and rebuild from scratch.
 *
 * A refused contract is not an agreement, and it cannot be what makes a quote
 * unchangeable. A SIGNED one still blocks, absolutely — that is an agreement,
 * and #727's rule that an accepted quote with a live contract is refused
 * outright is untouched.
 */
const CONTRACT_NO_LONGER_BLOCKS = new Set(["withdrawn", "declined"]);

export const QUOTE_LOCKED_BY_CONTRACT =
  "This quote can no longer be edited — a contract has been raised from it.";

export function quoteEditability(
  status: string,
  contract: { id: string; status?: string } | { id: string }[] | null | undefined,
): QuoteEditability {
  // The contract gate comes FIRST and applies to every status. A WITHDRAWN
  // contract does not block editing — treat it as if no contract exists. Only
  // live contracts (sent, signed) block.
  //
  // This now checks contract STATUS, not just presence. hasContract(contract)
  // tells us a row exists; the status tells us whether it is still active.
  const contractExists = hasContract(contract);
  const contractIsActive =
    contractExists &&
    (typeof contract === "object" &&
    !Array.isArray(contract) &&
    contract !== null &&
    "status" in contract
      ? !CONTRACT_NO_LONGER_BLOCKS.has(contract.status ?? "")
      : true);

  if (contractIsActive) {
    return { editable: false, reissues: false, reason: QUOTE_LOCKED_BY_CONTRACT };
  }

  if ((EDITABLE_STATUSES as readonly string[]).includes(status)) {
    return { editable: true, reissues: false };
  }

  // Accepted, no contract: editable, and editing withdraws the acceptance.
  if (status === "accepted") {
    return { editable: true, reissues: true };
  }

  // Declined, and anything unrecognised. A status this does not know about is
  // refused rather than allowed: the failure mode of guessing wrong here is
  // overwriting an agreed document.
  return { editable: false, reissues: false, reason: QUOTE_NOT_EDITABLE };
}

/**
 * The statuses a write path's UPDATE predicate may match.
 *
 * Wider than `EDITABLE_STATUSES` by exactly `accepted`, and it is NOT the whole
 * guard — the contract check cannot be expressed as a status filter, so it is
 * asserted separately on the read. The two together are the rule.
 *
 * Why the UPDATE still carries a status predicate at all: an acceptance landing
 * between the read and the write must not be silently overwritten. That race is
 * real and customer-driven. The contract race is not the same shape — a
 * contract is raised by the contractor, from their own session, so it cannot
 * arrive behind their back mid-edit the way an acceptance can.
 */
export const WRITABLE_QUOTE_STATUSES = [...EDITABLE_STATUSES, "accepted"] as const;
