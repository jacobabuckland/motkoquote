import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * LED-1 and LED-2 both created a `job_costs` table, incompatibly, and both
 * claimed migration version 41. Nothing stopped them being admitted: the poller
 * admits by readiness and a rate cap, neither of which knows that LED-2 builds
 * ON LED-1. The PM cannot see in-flight branches when it derives a spec, so a
 * later item is specced against a `main` without its predecessor's schema.
 */

interface Item {
  number: number;
  title: string;
  state: string;
  labels: string[];
}

const load = async () =>
  await import("../../scripts/factory/admission-order.mjs?t=" + Date.now());

const item = (over: Partial<Item> = {}): Item => ({
  number: 1,
  title: "LED-1: foundation",
  state: "open",
  labels: ["spec-derived"],
  ...over,
});

describe("reading a programme item's place in its sequence", () => {
  it("parses the programme and index from the title", async () => {
    const { parseProgrammeItem } = await load();
    expect(parseProgrammeItem("LED-3: Receipt photo capture")).toEqual({
      programme: "LED",
      index: 3,
    });
  });

  it("returns null for a title that is not part of a programme", async () => {
    const { parseProgrammeItem } = await load();
    for (const t of ["Improve the empty state", "LED3 no separator", "", "a-1: lowercase"]) {
      expect(parseProgrammeItem(t), t).toBeNull();
    }
  });
});

describe("holding a later item until its predecessor is done", () => {
  it("admits the first item of a programme unconditionally", async () => {
    const { admissionBlocker } = await load();
    expect(admissionBlocker("LED-1: foundation", [])).toBeNull();
  });

  it("does not gate programmes that are not sequential", async () => {
    const { admissionBlocker } = await load();
    expect(admissionBlocker("PAY-7: fee collection", [])).toBeNull();
  });

  it("holds an item whose predecessor is still being worked", async () => {
    const { admissionBlocker } = await load();
    const held = admissionBlocker("LED-2: cost entry", [
      item({ number: 244, title: "LED-1: foundation", labels: ["qa-changes"] }),
    ]);
    expect(held?.predecessor).toBe("LED-1");
    expect(held?.reason).toContain("#244");
    expect(held?.reason).toContain("qa-changes");
  });

  // The user's rule: LED-4 does not start until LED-3 is complete. Absence is
  // not permission — otherwise LED-5 sails past a LED-4 nobody has queued.
  it("holds an item whose predecessor has not entered the factory at all", async () => {
    const { admissionBlocker } = await load();
    const held = admissionBlocker("LED-5: exports", [
      item({ number: 244, title: "LED-1: foundation", labels: ["previewed"] }),
    ]);
    expect(held?.predecessor).toBe("LED-4");
    expect(held?.reason).toContain("not entered the factory yet");
  });

  it("admits once the predecessor reaches preview", async () => {
    const { admissionBlocker } = await load();
    expect(
      admissionBlocker("LED-2: cost entry", [
        item({ number: 244, title: "LED-1: foundation", labels: ["previewed"] }),
      ]),
    ).toBeNull();
  });

  // A shipped item is CLOSED and loses its stage labels, so treating "not found
  // among open issues" as "not started" would deadlock the programme forever
  // after its first item ships.
  it("counts a closed predecessor as done even with no labels left", async () => {
    const { admissionBlocker } = await load();
    expect(
      admissionBlocker("LED-2: cost entry", [
        item({ number: 244, title: "LED-1: foundation", state: "closed", labels: [] }),
      ]),
    ).toBeNull();
  });

  it("sequences a whole programme one at a time", async () => {
    const { admissionBlocker } = await load();
    const items = [
      item({ number: 1, title: "LED-1: a", labels: ["previewed"] }),
      item({ number: 2, title: "LED-2: b", labels: ["previewed"] }),
      item({ number: 3, title: "LED-3: c", labels: ["verify"] }),
      item({ number: 4, title: "LED-4: d", labels: ["needs-spec"] }),
    ];
    expect(admissionBlocker("LED-3: c", items), "3 may run, 2 previewed").toBeNull();
    expect(admissionBlocker("LED-4: d", items)?.predecessor, "4 waits on 3").toBe("LED-3");
    expect(admissionBlocker("LED-5: e", items)?.predecessor, "5 waits on 4").toBe("LED-4");
  });
});

describe("the runtime plumbing", () => {
  const poller = readFileSync("scripts/factory/poll-notion.mjs", "utf8");

  it("the poller consults the gate", () => {
    expect(poller).toContain("admissionBlocker");
    expect(poller).toContain("admission-order.mjs");
  });

  // Holding an item must not cost the queue a turn, or one held item starves
  // every unrelated item behind it for a whole poll interval.
  it("a held item does not consume a slot from the run cap", () => {
    const gate = /const held = [\s\S]*?if \(held\) \{[\s\S]*?\n    \}/.exec(poller)?.[0] ?? "";
    expect(gate, "the gate must exist").not.toBe("");
    expect(gate, "hold must `continue`, not count as started").toContain("continue");
    expect(gate).not.toContain("started++");
  });

  // #115's acceptance test drives this script through a mocked fetch whose call
  // SEQUENCE is part of its frozen contract. An unconditional issue-list request
  // shifted that sequence and broke it. The gate must cost nothing on a poll
  // with no sequenced item on the board.
  it("only reaches for the issue list when a sequenced item is present", () => {
    expect(poller).toContain("parseProgrammeItem(title)");
    expect(poller, "the fetch must be behind a function, not at top level").toContain(
      "loadKnownItems",
    );
    const gate = /const held = [\s\S]*?if \(held\) \{/.exec(poller)?.[0] ?? "";
    expect(gate, "the cheap title parse must guard the request").toMatch(
      /parseProgrammeItem\(title\)[\s\S]*loadKnownItems/,
    );
  });

  it("reads closed issues too, or a shipped predecessor deadlocks its successor", () => {
    expect(poller).toContain("state=all");
  });

  // Failing closed here would stop the whole queue over a transient API error,
  // which is a worse trade than one poll without ordering enforced.
  it("says so rather than stopping the queue if it cannot read the issues", () => {
    expect(poller).toContain("admission ordering");
    expect(poller).toContain("::warning::");
  });
});

// The price-fidelity chain (28 Aug 2026 quote-flow defect review) is sequential
// for the same reason LED was: each item consumes the shape the previous one
// introduced. PRICE-2 drafts from PRICE-1's stated_prices record; PRICE-4
// reconciles using the provenance PRICE-3 adds. Specced against a main without
// its predecessor, a later item has nothing to build on.
describe("the price-fidelity programme is sequenced", () => {
  it("recognises PRICE as a sequential programme", async () => {
    const { SEQUENTIAL_PROGRAMMES, parseProgrammeItem } = await load();
    expect(SEQUENTIAL_PROGRAMMES).toContain("PRICE");
    expect(parseProgrammeItem("PRICE-2: Locked line items in drafting")).toEqual({
      programme: "PRICE",
      index: 2,
    });
  });

  it("admits PRICE-1 unconditionally", async () => {
    const { admissionBlocker } = await load();
    expect(admissionBlocker("PRICE-1: Structured price extraction", [])).toBeNull();
  });

  it("holds PRICE-2 until PRICE-1 has reached preview", async () => {
    const { admissionBlocker } = await load();
    const held = admissionBlocker("PRICE-2: Locked line items in drafting", [
      item({ number: 500, title: "PRICE-1: Structured price extraction", labels: ["spec-derived"] }),
    ]);
    expect(held?.predecessor).toBe("PRICE-1");
  });

  it("releases PRICE-2 once PRICE-1 is previewed", async () => {
    const { admissionBlocker } = await load();
    expect(
      admissionBlocker("PRICE-2: Locked line items in drafting", [
        item({ number: 500, title: "PRICE-1: Structured price extraction", labels: ["previewed"] }),
      ]),
    ).toBeNull();
  });

  it("holds PRICE-4 when PRICE-3 has not been queued at all", async () => {
    // Absence is not permission: PRICE-4 reconciles against provenance that
    // PRICE-3 introduces, so it must not sail past an unqueued predecessor.
    const { admissionBlocker } = await load();
    const held = admissionBlocker("PRICE-4: Reconciliation gate", [
      item({ number: 500, title: "PRICE-1: Structured price extraction", state: "closed", labels: [] }),
    ]);
    expect(held?.predecessor).toBe("PRICE-3");
  });

  it("leaves LED's existing sequencing untouched", async () => {
    const { admissionBlocker } = await load();
    expect(admissionBlocker("LED-1: foundation", [])).toBeNull();
    expect(
      admissionBlocker("LED-2: cost entry", [
        item({ number: 244, title: "LED-1: foundation", labels: ["previewed"] }),
      ]),
    ).toBeNull();
  });
});
