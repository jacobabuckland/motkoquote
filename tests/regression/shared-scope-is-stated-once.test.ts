/**
 * Work that applies to the whole job is stated once, not repeated under every
 * room.
 *
 * The SOW schema requires `work_items` per room and cannot express "applies to
 * the whole job", so when a contractor says "make good throughout" the model
 * writes it into every room. Every multi-room job recorded since 1 Sep is
 * 67–83% duplicate by this measure: 5 rooms carrying 2 distinct items between
 * them, 6 rooms carrying 1, 4 rooms carrying 1.
 *
 * That reaches the customer's quote as the same sentence printed five times,
 * and the quote is the document an acceptance binds to.
 *
 * This is the RENDER-side half, and deliberately the only half for now. The
 * capture-side change — an optional job-level slot on the SOW — is a change to
 * the tool schema, which only ASKS the model to behave differently; #373's own
 * problem statement is that a rule living in a 7,680-character instruction
 * string is "instruction dilution, not a check". It would also give one fact
 * two homes, and every consumer would have to merge them. This holds whatever
 * the model does, and adds no second source.
 *
 * The rule is deliberately strict: an item is only lifted when it appears in
 * EVERY room and there is more than one room. Four rooms out of five keeps it
 * per-room, so collapsing can never hide a genuine difference between rooms.
 */

import { describe, expect, it } from "vitest";

import { splitWholeJobWorkItems } from "@/lib/scope-whole-job";

const room = (name: string, workItems: string[], dimensions?: string) => ({
  name,
  dimensions,
  workItems,
});

describe("work stated for every room is lifted out of the rooms", () => {
  it("lifts the single item six rooms all repeat", () => {
    // Job 7215aa49: 6 rooms, 1 distinct item, 6 in total.
    const rooms = ["Hall", "Lounge", "Kitchen", "Bed 1", "Bed 2", "Landing"].map((n) =>
      room(n, ["Skim and make good"]),
    );

    const split = splitWholeJobWorkItems(rooms);

    expect(split.wholeJobItems).toEqual(["Skim and make good"]);
    expect(split.rooms.map((r) => r.workItems)).toEqual([[], [], [], [], [], []]);
  });

  it("keeps the rooms themselves, even once they carry no items of their own", () => {
    // The room list is information the customer needs — WHICH rooms — and it
    // must survive the lift. Dropping them would trade one defect for a worse
    // one.
    const rooms = ["Hall", "Lounge"].map((n) => room(n, ["Make good"]));

    expect(splitWholeJobWorkItems(rooms).rooms.map((r) => r.name)).toEqual(["Hall", "Lounge"]);
  });

  it("lifts only what is shared, leaving each room its own work", () => {
    const split = splitWholeJobWorkItems([
      room("Kitchen", ["Make good", "Replace six sockets"]),
      room("Landing", ["Make good", "Two-way switch"]),
    ]);

    expect(split.wholeJobItems).toEqual(["Make good"]);
    expect(split.rooms.map((r) => r.workItems)).toEqual([
      ["Replace six sockets"],
      ["Two-way switch"],
    ]);
  });

  it("preserves the order the first room stated them in", () => {
    const split = splitWholeJobWorkItems([
      room("Kitchen", ["Dust sheets", "Make good"]),
      room("Landing", ["Make good", "Dust sheets"]),
    ]);

    expect(split.wholeJobItems).toEqual(["Dust sheets", "Make good"]);
  });

  it("keeps dimensions on a room whose items were all lifted", () => {
    const split = splitWholeJobWorkItems([
      room("Kitchen", ["Make good"], "4m x 3m"),
      room("Landing", ["Make good"]),
    ]);

    expect(split.rooms[0]).toEqual({ name: "Kitchen", dimensions: "4m x 3m", workItems: [] });
  });
});

describe("what it refuses to lift", () => {
  it("leaves an item shared by all but one room exactly where it is", () => {
    // The load-bearing restraint. If "make good" is genuinely not happening in
    // the bathroom, lifting it would put work on the document that was never
    // agreed — the same class of defect, pointing the other way.
    const split = splitWholeJobWorkItems([
      room("Kitchen", ["Make good"]),
      room("Landing", ["Make good"]),
      room("Bathroom", ["Tile splashback"]),
    ]);

    expect(split.wholeJobItems).toEqual([]);
    expect(split.rooms.map((r) => r.workItems)).toEqual([
      ["Make good"],
      ["Make good"],
      ["Tile splashback"],
    ]);
  });

  it("lifts nothing from a single room, which cannot repeat anything", () => {
    const rooms = [room("Kitchen", ["Make good", "Six sockets"])];

    const split = splitWholeJobWorkItems(rooms);

    expect(split.wholeJobItems).toEqual([]);
    expect(split.rooms).toEqual(rooms);
  });

  it("lifts nothing when a room has no items at all", () => {
    // Nothing can appear in every room when one room lists nothing.
    const split = splitWholeJobWorkItems([
      room("Kitchen", ["Make good"]),
      room("Loft", [], "3m x 2m"),
    ]);

    expect(split.wholeJobItems).toEqual([]);
  });

  it("handles an empty room list", () => {
    expect(splitWholeJobWorkItems([])).toEqual({ wholeJobItems: [], rooms: [] });
  });
});

describe("matching is forgiving about how the model wrote it", () => {
  it("treats casing and surrounding space as the same item", () => {
    const split = splitWholeJobWorkItems([
      room("Kitchen", ["Make good"]),
      room("Landing", ["  make good  "]),
    ]);

    // Lifted once, in the wording the first room used.
    expect(split.wholeJobItems).toEqual(["Make good"]);
    expect(split.rooms.every((r) => r.workItems.length === 0)).toBe(true);
  });

  it("does not treat two different sentences as the same", () => {
    const split = splitWholeJobWorkItems([
      room("Kitchen", ["Make good the chases"]),
      room("Landing", ["Make good the ceiling"]),
    ]);

    expect(split.wholeJobItems).toEqual([]);
  });
});

describe("the customer document states it once", () => {
  it("carries the lifted items on the scope, out of the rooms", async () => {
    const { buildQuoteScope } = await import("@/lib/pdf/quote-payload");
    const { EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

    // Job f453b3ae as captured: 5 rooms, 2 distinct items, 10 in total.
    const shared = ["Make good cupboards", "Dust sheets throughout"];
    const scope = buildQuoteScope(
      {
        ...EMPTY_SOW_STATE,
        rooms: ["Bed 1", "Bed 2", "Bed 3", "Landing", "Hall"].map((name) => ({
          name,
          dimensions: undefined,
          work_items: [...shared],
        })),
      },
      [],
    );

    expect(scope?.wholeJobItems).toEqual(shared);
    // Said once on the document, not five times.
    expect(scope?.rooms.flatMap((r) => r.workItems)).toEqual([]);
    expect(scope?.rooms.map((r) => r.name)).toEqual([
      "Bed 1",
      "Bed 2",
      "Bed 3",
      "Landing",
      "Hall",
    ]);
  });

  it("still drops a room carrying neither work items nor dimensions", async () => {
    // The pre-existing rule, which the lift must not disturb: a room emptied by
    // the LIFT is kept, a room that was empty to begin with is dropped.
    const { buildQuoteScope } = await import("@/lib/pdf/quote-payload");
    const { EMPTY_SOW_STATE } = await import("@/lib/schemas/sow");

    const scope = buildQuoteScope(
      {
        ...EMPTY_SOW_STATE,
        rooms: [
          { name: "Kitchen", dimensions: undefined, work_items: ["Make good"] },
          { name: "Landing", dimensions: undefined, work_items: ["Make good"] },
          { name: "Loft", dimensions: undefined, work_items: [] },
        ],
      },
      [],
    );

    expect(scope?.rooms.map((r) => r.name)).toEqual(["Kitchen", "Landing"]);
    expect(scope?.wholeJobItems).toEqual(["Make good"]);
  });
});
