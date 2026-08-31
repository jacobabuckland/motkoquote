/**
 * S1's decision logic: staleness, health, and where `status_since` comes from.
 *
 * The `status_since` cases are the ones with teeth. A hard constraint says it
 * must come from the status-change history and never from `last_edited_time`,
 * because "every unrelated edit resets staleness" turns every threshold in the
 * table into one that never fires — a stuck ticket edited once a day is a stuck
 * ticket nobody hears about.
 */

import { describe, expect, it } from "vitest";

import {
  NO_LINKAGE,
  computeFactoryIdle,
  computeHealth,
  crossedThresholds,
  hoursBetween,
  isKnownModule,
  normaliseModule,
  resolveStatusSince,
} from "../../scripts/supervisor/snapshot-core";
import { issueRefFromUrl } from "../../scripts/supervisor/github";
import type { TicketSnapshot } from "../../scripts/supervisor/types";

const NOW = "2026-08-31T12:00:00.000Z";
const hoursAgo = (n: number) => new Date(Date.parse(NOW) - n * 3_600_000).toISOString();

function ticket(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    db: "roadmap",
    name: "A card",
    status: "In factory",
    module: "quotes",
    status_since: hoursAgo(1),
    issue: 481,
    pr: null,
    preview_url: null,
    preview_status: "unknown",
    halt_open: false,
    qa_rejections: 0,
    ...overrides,
  };
}

describe("status_since", () => {
  it("prefers the GitHub label event over everything else", () => {
    const fromEvents = hoursAgo(6);
    const previous = ticket({ status_since: hoursAgo(50) });
    expect(resolveStatusSince(fromEvents, previous, "In factory", NOW)).toBe(fromEvents);
  });

  it("carries the previous value forward when the status has not changed", () => {
    // This is what keeps a threshold firing for a ticket whose label event has
    // aged out of the ten-page event window — a `Needs spec` item at 72h is
    // exactly the case where the event is oldest.
    const previous = ticket({ status_since: hoursAgo(80) });
    expect(resolveStatusSince(null, previous, "In factory", NOW)).toBe(previous.status_since);
  });

  it("restarts the clock when the status HAS changed", () => {
    const previous = ticket({ status: "Needs spec", status_since: hoursAgo(80) });
    expect(resolveStatusSince(null, previous, "In factory", NOW)).toBe(NOW);
  });

  it("starts a first-seen ticket's clock now, rather than reporting it as stale", () => {
    // A fresh factory-state branch must not report the whole board as overdue
    // on its second run. Every ticket starts now; the thresholds fire later, on
    // real elapsed time.
    expect(resolveStatusSince(null, undefined, "Blocked", NOW)).toBe(NOW);
  });
});

describe("staleness thresholds", () => {
  it.each([
    ["In factory", 4],
    ["Blocked", 24],
    ["Previewed", 48],
    ["Needs spec", 72],
  ] as const)("fires for %s at %ih and not before", (status, hours) => {
    const just = ticket({ status, status_since: hoursAgo(hours - 0.5) });
    const over = ticket({ status, status_since: hoursAgo(hours + 0.5) });

    expect(crossedThresholds("page1", just, NOW)).toEqual([]);
    expect(crossedThresholds("page1", over, NOW)).toHaveLength(1);
  });

  it("encodes the status and the hours in the crossing id", () => {
    const over = ticket({ status: "In factory", status_since: hoursAgo(5) });
    expect(crossedThresholds("page1", over, NOW)).toEqual(["page1:in_factory_4h"]);
  });

  it("has no threshold for the statuses the table does not name", () => {
    for (const status of ["Backlog", "Shipped", "Ready for factory"]) {
      expect(crossedThresholds("page1", ticket({ status, status_since: hoursAgo(500) }), NOW)).toEqual([]);
    }
  });
});

describe("factory_idle", () => {
  it("is true when something has been queued 2h+ with nothing in factory", () => {
    const tickets = { a: ticket({ status: "Ready for factory", status_since: hoursAgo(3) }) };
    expect(computeFactoryIdle(tickets, NOW)).toBe(true);
  });

  it("is false while anything is in factory", () => {
    const tickets = {
      a: ticket({ status: "Ready for factory", status_since: hoursAgo(9) }),
      b: ticket({ status: "In factory" }),
    };
    expect(computeFactoryIdle(tickets, NOW)).toBe(false);
  });

  it("is false for an EMPTY queue, which is not the same as a dead poller", () => {
    // Conflating the two would file a bug every night the queue drained.
    expect(computeFactoryIdle({ a: ticket({ status: "Shipped" }) }, NOW)).toBe(false);
    expect(computeFactoryIdle({}, NOW)).toBe(false);
  });

  it("is false for something queued only briefly", () => {
    const tickets = { a: ticket({ status: "Ready for factory", status_since: hoursAgo(1) }) };
    expect(computeFactoryIdle(tickets, NOW)).toBe(false);
  });
});

describe("module normalisation", () => {
  it("groups payment and payments as one value", () => {
    expect(normaliseModule("payment")).toBe(normaliseModule("payments"));
  });

  it("reports neither spelling as unknown, so only a THIRD variant fires", () => {
    expect(isKnownModule("payment")).toBe(true);
    expect(isKnownModule("payments")).toBe(true);
    expect(isKnownModule("paymnets")).toBe(false);
  });
});

describe("the module list matches the board", () => {
  // Read off the live Roadmap `Module` select on 31 Aug. The first draft of
  // KNOWN_MODULES was INVENTED from the codebase's vocabulary — quotes,
  // contracts, invoices, jobs, auth — none of which the board uses. T4 files
  // one bug per distinct unknown module value, so the supervisor's first run
  // with a diff would have opened five `[supervisor]` tickets about a board
  // that was entirely correct.
  //
  // If this fails, someone added an option to the select. Add it to
  // KNOWN_MODULES rather than deleting the case: an option missing from that
  // list files a bug the first time anyone uses it.
  const BOARD_OPTIONS = [
    "factory",
    "security",
    "data",
    "settlement",
    "payment",
    "payments",
    "voice",
    "ui",
    "app",
  ];

  it.each(BOARD_OPTIONS)("treats %s as known", (option) => {
    expect(isKnownModule(option)).toBe(true);
  });

  it("treats the unset placeholder as known, so an empty Module is not a finding", () => {
    expect(isKnownModule("unassigned")).toBe(true);
  });

  it("still catches a genuine typo", () => {
    expect(isKnownModule("paymnets")).toBe(false);
    expect(isKnownModule("factry")).toBe(false);
  });
});

describe("Notion health", () => {
  it("counts null titles rather than throwing on them", () => {
    // The August blank row took the poller down. Counting is the whole fix.
    const health = computeHealth(
      [
        { title: null, status: "Backlog", module: "quotes" },
        { title: "Fine", status: "Backlog", module: "quotes" },
      ],
      NO_LINKAGE,
    );
    expect(health.null_title_rows).toBe(1);
  });

  it("reports unknown status and module values, de-duplicated and sorted", () => {
    const health = computeHealth(
      [
        { title: "a", status: "Doing", module: "quots" },
        { title: "b", status: "Doing", module: "aaa" },
      ],
      { unlinked: 3, linked_to_pr: 2, linked_outside_factory: 1 },
    );
    expect(health.unknown_status_values).toEqual(["Doing"]);
    expect(health.unknown_module_values).toEqual(["aaa", "quots"]);
    expect(health.unlinked).toBe(3);
    expect(health.linked_to_pr).toBe(2);
    expect(health.linked_outside_factory).toBe(1);
  });

  it("reports nothing for a clean board", () => {
    const health = computeHealth(
      [{ title: "a", status: "Shipped", module: "payments" }],
      NO_LINKAGE,
    );
    expect(health).toEqual({
      null_title_rows: 0,
      unknown_status_values: [],
      unknown_module_values: [],
      unlinked: 0,
      linked_to_pr: 0,
      linked_outside_factory: 0,
    });
  });
});

describe("hoursBetween", () => {
  it("measures forward in hours", () => {
    expect(hoursBetween(hoursAgo(4), NOW)).toBeCloseTo(4, 5);
  });
});

describe("what the GitHub Issue property points at", () => {
  // The first live run reported `unlinked: 86` of 185 tickets, which reads as
  // 86 broken links and was nothing of the sort. 38 of them hold a `/pull/`
  // URL — 36 of the Bugs board's 45 linked rows — and the parser matched
  // `/issues/(\d+)` and nothing else, so a board following its own convention
  // counted as broken.
  it("reads an issue URL", () => {
    expect(issueRefFromUrl("https://github.com/o/r/issues/481")).toEqual({
      number: 481,
      kind: "issue",
    });
  });

  it("reads a pull-request URL, which was previously invisible", () => {
    expect(issueRefFromUrl("https://github.com/o/r/pull/431")).toEqual({
      number: 431,
      kind: "pull",
    });
  });

  it("keeps the two apart even though GitHub numbers them together", () => {
    // The naive fix is to normalise `/pull/N` to `/issues/N` and move on, since
    // they name the same object. They do not carry the same DATA: stopped
    // labels, qa_rejections and issue state are read off the linked object and
    // a PR has none of them, so a merged reading would resolve `halt_open:
    // false` for a ticket whose halt nobody had looked at.
    const asIssue = issueRefFromUrl("https://github.com/o/r/issues/431");
    const asPull = issueRefFromUrl("https://github.com/o/r/pull/431");
    expect(asIssue?.number).toBe(asPull?.number);
    expect(asIssue?.kind).not.toBe(asPull?.kind);
  });

  it("tolerates a trailing fragment or query", () => {
    expect(issueRefFromUrl("https://github.com/o/r/issues/481#issuecomment-9")?.number).toBe(481);
    expect(issueRefFromUrl("https://github.com/o/r/pull/431/files")?.number).toBe(431);
  });

  it("returns null for an empty property and for a URL naming neither", () => {
    expect(issueRefFromUrl(null)).toBeNull();
    expect(issueRefFromUrl("")).toBeNull();
    expect(issueRefFromUrl("https://github.com/o/r")).toBeNull();
    expect(issueRefFromUrl("https://example.invalid/issues/x")).toBeNull();
  });
});
