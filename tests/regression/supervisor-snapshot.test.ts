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
  computeFactoryIdle,
  computeHealth,
  crossedThresholds,
  hoursBetween,
  isKnownModule,
  normaliseModule,
  resolveStatusSince,
} from "../../scripts/supervisor/snapshot-core";
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

describe("Notion health", () => {
  it("counts null titles rather than throwing on them", () => {
    // The August blank row took the poller down. Counting is the whole fix.
    const health = computeHealth(
      [
        { title: null, status: "Backlog", module: "quotes" },
        { title: "Fine", status: "Backlog", module: "quotes" },
      ],
      0,
    );
    expect(health.null_title_rows).toBe(1);
  });

  it("reports unknown status and module values, de-duplicated and sorted", () => {
    const health = computeHealth(
      [
        { title: "a", status: "Doing", module: "quots" },
        { title: "b", status: "Doing", module: "aaa" },
      ],
      3,
    );
    expect(health.unknown_status_values).toEqual(["Doing"]);
    expect(health.unknown_module_values).toEqual(["aaa", "quots"]);
    expect(health.unlinked).toBe(3);
  });

  it("reports nothing for a clean board", () => {
    const health = computeHealth([{ title: "a", status: "Shipped", module: "payments" }], 0);
    expect(health).toEqual({
      null_title_rows: 0,
      unknown_status_values: [],
      unknown_module_values: [],
      unlinked: 0,
    });
  });
});

describe("hoursBetween", () => {
  it("measures forward in hours", () => {
    expect(hoursBetween(hoursAgo(4), NOW)).toBeCloseTo(4, 5);
  });
});
