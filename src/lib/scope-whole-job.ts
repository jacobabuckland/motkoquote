// Work that applies to the whole job, said once instead of under every room.
//
// The SOW schema requires `work_items` per room and has no way to express
// "applies throughout", so when a contractor says "and make good everywhere"
// the model writes it into every room. Every multi-room job recorded since
// 1 Sep is 67–83% duplicate by this measure — five rooms carrying two distinct
// items between them, six carrying one, four carrying one — and that reaches
// the customer as the same sentence printed five times, on the document their
// acceptance binds to.
//
// This is the RENDER-side half, and deliberately the only half for now.
//
// The capture-side alternative — an optional job-level slot on the SOW — only
// ASKS the model to behave differently, and #373's own problem statement is
// that a rule living in a 7,680-character instruction string is "instruction
// dilution, not a check". It would also give one fact two homes, so every
// consumer would have to merge them: the exact "two constructions of one
// thing" shape that produced the missing site address, the unreachable Setup
// section and the blank contract dates in the same week. This holds whatever
// the model does, and adds no second source. Decision 8 Sep 2026 — see
// areas/motko.md.

export type ScopeRoom = {
  name: string;
  dimensions?: string;
  workItems: string[];
};

export type SplitScope = {
  /** Stated once, above the rooms. Empty unless something is in EVERY room. */
  wholeJobItems: string[];
  /** The same rooms, in order, with the lifted items removed. */
  rooms: ScopeRoom[];
};

// Trimmed and case-folded, so "Make good" and "  make good  " are one item.
// Only for comparison — what gets printed is always the wording as written.
const key = (item: string): string => item.trim().toLowerCase();

/**
 * Lifts out the work items every room shares.
 *
 * An item qualifies only if it appears in EVERY room, and only when there is
 * more than one room. That restraint is the point: an item in four rooms out of
 * five stays where it is, because lifting it would put work on the document for
 * a room that was never agreed to it — the same defect pointing the other way.
 *
 * Rooms are returned in order and none is dropped, including a room whose items
 * were all lifted. Which rooms the job covers is information the customer
 * needs, and it must survive the lift. (`buildQuoteScope` drops rooms that
 * carried nothing to begin with, before calling this.)
 */
export const splitWholeJobWorkItems = (rooms: ScopeRoom[]): SplitScope => {
  if (rooms.length < 2) return { wholeJobItems: [], rooms };

  const [first, ...rest] = rooms;
  const sharedKeys = new Set(
    first.workItems
      .map(key)
      .filter((k) => rest.every((room) => room.workItems.some((item) => key(item) === k))),
  );

  if (sharedKeys.size === 0) return { wholeJobItems: [], rooms };

  return {
    // The first room's wording and order — one of them has to win, and the
    // first is the one the reader would have met first anyway.
    wholeJobItems: first.workItems.filter((item) => sharedKeys.has(key(item))),
    rooms: rooms.map((room) => ({
      ...room,
      workItems: room.workItems.filter((item) => !sharedKeys.has(key(item))),
    })),
  };
};
