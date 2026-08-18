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
export const SEQUENTIAL_PROGRAMMES = ["LED"];

/** A stage an item must have reached before its successor may start. */
const SATISFIED_LABELS = ["previewed", "shipped"];

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
      reason: `#${predecessor.item.number} ${name} has not reached preview yet (${stage})`,
      predecessor: name,
    };
  }

  return null;
}
