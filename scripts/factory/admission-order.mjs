/**
 * Admission ordering for programmes whose items must run one at a time.
 *
 * WHY. LED-1 and LED-2 both created a `job_costs` table, incompatibly, and both
 * claimed migration version 41. Nothing stopped them: the poller admits by
 * readiness and a rate cap, neither of which knows that LED-2 builds ON LED-1.
 * The collision surfaced at CI, after two items had been specced and built —
 * and only because the cross-branch check happened to exist. The second
 * migration to reach production would have failed on "relation job_costs
 * already exists", by hand, after the first was applied.
 *
 * The PM cannot see in-flight branches when it derives a spec, so a later item
 * in a stacked programme is specced against a `main` that does not yet have its
 * predecessor's schema. That is not a PM bug to fix in a prompt; it is a
 * sequencing fact, and sequencing belongs at admission — the one place items
 * enter the factory.
 *
 * Pure: titles and item states in, a verdict out. No network, so the rule is
 * exercised by tests rather than only in anger.
 */

/**
 * Programmes whose items must be admitted strictly in order. Add a prefix here
 * only when later items genuinely build on earlier ones — an unnecessary entry
 * serialises work that could have run in parallel, which is a real cost.
 */
export const SEQUENTIAL_PROGRAMMES = ["LED", "PRICE"];

// PRICE is the price-fidelity chain from the 28 Aug 2026 quote-flow defect
// review. It is sequential in the same way LED was, and for the same reason —
// each item consumes the shape the previous one introduced:
//
//   PRICE-1  extracts spoken amounts into a `stated_prices` record
//   PRICE-2  drafts from that record as immutable line items
//   PRICE-3  adds a provenance reference to those line items
//   PRICE-4  reconciles stated against rendered, using that provenance
//   PRICE-5  guards the language and double-charge rules the gate enforces
//
// Specced out of order, PRICE-2 would be written against a `main` with no
// stated_prices to receive, and PRICE-4 against line items with no provenance
// to check — the same "PM cannot see in-flight branches" failure that had LED-1
// and LED-2 both creating job_costs at migration version 41.

/**
 * A stage an item must have reached before its successor may start.
 *
 * `previewed` is NOT enough, and used to be. It means QA passed and the PR is
 * ready — it does not mean the work is on `main`, and `main` is the only thing
 * the successor's PM can see. `shipped` is applied by factory-ship.yml at
 * merge, which is the event that matters.
 *
 * PRICE-2 proved it on 28 Aug, in exactly the shape this file was written to
 * prevent. PRICE-1 reached `previewed` at 20:49 with its PR still open; PRICE-2
 * was admitted, and its PM derived a spec at 20:57 against a `main` that did
 * not receive PRICE-1 until 21:03. The Engineer then created
 * src/lib/voice/stated-prices.ts from scratch — a file PRICE-1 had already
 * written — and the branch met `main` with an add/add conflict on it.
 *
 * That is LED-1 and LED-2 both creating job_costs, reached through a different
 * door. The header below says the successor is specced against a main that does
 * not yet have its predecessor's schema; releasing on `previewed` makes that
 * sentence describe the gate rather than the bug.
 *
 * The cost is real: a programme is now serialised on MERGES rather than on
 * reviews, so a predecessor sitting in an open PR holds its successor. That is
 * the trade the gate exists to make. An item that is genuinely independent
 * should not carry a sequenced prefix.
 */
const SATISFIED_LABELS = ["shipped"];

/**
 * "LED-3: Receipt photo capture" -> { programme: "LED", index: 3 }
 * Anything else -> null, which means "not part of a sequenced programme".
 */
export function parseProgrammeItem(title) {
  const match = /^\s*([A-Z]{2,6})-(\d+)\s*[:.]/.exec(String(title ?? ""));
  if (!match) return null;
  return { programme: match[1], index: Number(match[2]) };
}

/** Has this item got far enough that its successor may start? */
export function isSatisfied(item) {
  if (!item) return false;
  if (item.state === "closed") return true;
  const labels = item.labels ?? [];
  return SATISFIED_LABELS.some((l) => labels.includes(l));
}

/**
 * Why this title may not be admitted yet, or null if it may.
 *
 * `items` is every factory issue known — open AND closed. Closed matters: a
 * shipped predecessor is closed, and treating "not found among open issues" as
 * "not started" would deadlock the whole programme after its first item ships.
 */
export function admissionBlocker(title, items = []) {
  const candidate = parseProgrammeItem(title);
  if (!candidate) return null;
  if (!SEQUENTIAL_PROGRAMMES.includes(candidate.programme)) return null;
  if (candidate.index <= 1) return null;

  const predecessorIndex = candidate.index - 1;
  const predecessor = items
    .map((i) => ({ item: i, parsed: parseProgrammeItem(i.title) }))
    .find(
      ({ parsed }) =>
        parsed?.programme === candidate.programme && parsed.index === predecessorIndex,
    );

  const name = `${candidate.programme}-${predecessorIndex}`;

  // Not created yet. Blocking here is what stops LED-5 jumping ahead of LED-4
  // simply because LED-4 has not been queued — order is the point, not merely
  // "something earlier is in flight".
  if (!predecessor) {
    return {
      reason: `${name} has not entered the factory yet`,
      predecessor: name,
    };
  }

  if (!isSatisfied(predecessor.item)) {
    const stage = (predecessor.item.labels ?? []).join(", ") || "no stage";
    return {
      reason: `#${predecessor.item.number} ${name} has not merged yet (${stage})`,
      predecessor: name,
    };
  }

  return null;
}
