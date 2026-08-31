/**
 * S2's acceptance criteria, as fixtures.
 *
 * Two halves, and the second is the one that matters:
 *
 *   - each of §6's ten events fires, exactly once, on the pair that should
 *     produce it;
 *   - the four things §6 explicitly excludes produce NOTHING.
 *
 * The exclusions are the reason this file exists. Every one of them changes on
 * a normal hour of a healthy factory, so getting one wrong does not break the
 * supervisor — it makes it emit a digest every hour, which is exactly the
 * failure the whole spec is written against ("zero digests emitted on hours
 * with no change"). A supervisor that cries every hour is worse than none,
 * because it trains the one person reading it to stop.
 */

import { describe, expect, it } from "vitest";

import { computeEvents, idempotencyKey } from "../../scripts/supervisor/diff-core";
import type { Snapshot, TicketSnapshot } from "../../scripts/supervisor/types";

const T0 = "2026-08-31T09:00:00.000Z";
const T1 = "2026-08-31T10:00:00.000Z";

function ticket(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    db: "roadmap",
    name: "Send quote from the job page",
    status: "In factory",
    module: "quotes",
    status_since: T0,
    issue: 481,
    pr: "https://github.com/jacobabuckland/motkoquote/pull/482",
    preview_url: null,
    preview_status: "ready",
    halt_open: false,
    qa_rejections: 0,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    taken_at: T0,
    main: { sha: "aaaaaaa", ci: "green", run_url: "https://example.invalid/run/1" },
    live_checks: {
      state: "green",
      run_url: "https://example.invalid/live/1",
      completed_at: T0,
      stale: false,
    },
    tickets: { page1: ticket() },
    thresholds_crossed: [],
    notion_health: {
      null_title_rows: 0,
      unknown_status_values: [],
      unknown_module_values: [],
      unlinked: 0,
    },
    factory_idle: false,
    ...overrides,
  };
}

describe("the supervisor diff — silence", () => {
  it("emits nothing for two identical snapshots", () => {
    expect(computeEvents(snapshot(), snapshot({ taken_at: T1 }))).toEqual([]);
  });

  it("emits nothing on the first run, when there is no baseline", () => {
    // Otherwise the very first digest names the entire board, and whoever reads
    // it learns that the digest is noise.
    expect(computeEvents(null, snapshot())).toEqual([]);
  });

  it("does not treat status_since ticking as a change", () => {
    // §6's first exclusion. status_since moves in real time by construction,
    // so this would fire on every ticket every hour.
    const before = snapshot();
    const after = snapshot({
      taken_at: T1,
      tickets: { page1: ticket({ status_since: "2026-08-30T00:00:00.000Z" }) },
    });
    expect(computeEvents(before, after)).toEqual([]);
  });

  it("does not treat main advancing with CI still green as a change", () => {
    const after = snapshot({
      taken_at: T1,
      main: { sha: "bbbbbbb", ci: "green", run_url: "https://example.invalid/run/2" },
    });
    expect(computeEvents(snapshot(), after)).toEqual([]);
  });

  it("does not treat a preview going building → ready as a change", () => {
    const before = snapshot({ tickets: { page1: ticket({ preview_status: "building" }) } });
    const after = snapshot({
      taken_at: T1,
      tickets: { page1: ticket({ preview_status: "ready" }) },
    });
    expect(computeEvents(before, after)).toEqual([]);
  });

  it("does not treat preview_status unknown as a change, in either direction", () => {
    // §4.4 made `unknown` common — with no Vercel token, any ticket whose
    // deployment has aged out reads unknown. Treating it as a transition would
    // report a failure and a recovery for every such ticket, twice a day.
    const ready = snapshot({ tickets: { page1: ticket({ preview_status: "ready" }) } });
    const unknown = snapshot({
      taken_at: T1,
      tickets: { page1: ticket({ preview_status: "unknown" }) },
    });

    expect(computeEvents(ready, unknown)).toEqual([]);
    expect(computeEvents(unknown, ready)).toEqual([]);
  });

  it("does not treat CI passing through pending as a flip", () => {
    const green = snapshot();
    const pending = snapshot({
      taken_at: T1,
      main: { sha: "bbbbbbb", ci: "pending", run_url: null },
    });
    expect(computeEvents(green, pending)).toEqual([]);
  });

  it("does not re-report a Notion health finding that is merely still present", () => {
    const health = {
      null_title_rows: 1,
      unknown_status_values: ["Doing"],
      unknown_module_values: [],
      unlinked: 0,
    };
    const before = snapshot({ notion_health: health });
    const after = snapshot({ taken_at: T1, notion_health: { ...health } });
    expect(computeEvents(before, after)).toEqual([]);
  });

  it("does not re-fire a threshold the previous snapshot had already crossed", () => {
    const crossed = ["page1:in_factory_4h"];
    const before = snapshot({ thresholds_crossed: crossed });
    const after = snapshot({ taken_at: T1, thresholds_crossed: [...crossed] });
    expect(computeEvents(before, after)).toEqual([]);
  });
});

describe("the supervisor diff — the ten change events", () => {
  it("1. reports a status transition", () => {
    const after = snapshot({
      taken_at: T1,
      tickets: { page1: ticket({ status: "Previewed" }) },
    });
    const events = computeEvents(snapshot(), after);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "status_transition",
      page_id: "page1",
      from: "In factory",
      to: "Previewed",
    });
  });

  it("2. reports a new ticket, and does not also report it as a transition", () => {
    const after = snapshot({
      taken_at: T1,
      tickets: { page1: ticket(), page2: ticket({ name: "New card", status: "Backlog" }) },
    });
    const events = computeEvents(snapshot(), after);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "new_ticket", page_id: "page2", to: "Backlog" });
  });

  it("3. reports main CI flipping green → red, and red → green", () => {
    const red = snapshot({
      taken_at: T1,
      main: { sha: "bbbbbbb", ci: "red", run_url: "https://example.invalid/run/2" },
    });
    expect(computeEvents(snapshot(), red)[0]).toMatchObject({
      kind: "ci_flip",
      from: "green",
      to: "red",
    });
    expect(computeEvents(red, snapshot({ taken_at: T1 }))[0]).toMatchObject({
      kind: "ci_flip",
      from: "red",
      to: "green",
    });
  });

  it("4. reports a preview failing, and recovering", () => {
    const failed = snapshot({
      taken_at: T1,
      tickets: { page1: ticket({ preview_status: "failed" }) },
    });
    expect(computeEvents(snapshot(), failed)[0]).toMatchObject({ kind: "preview_failed" });
    expect(computeEvents(failed, snapshot({ taken_at: T1 }))[0]).toMatchObject({
      kind: "preview_recovered",
    });
  });

  it("5, 6. reports a halt opening and a halt closing", () => {
    const halted = snapshot({
      taken_at: T1,
      tickets: { page1: ticket({ halt_open: true }) },
    });
    expect(computeEvents(snapshot(), halted)[0]).toMatchObject({ kind: "halt_opened" });
    expect(computeEvents(halted, snapshot({ taken_at: T1 }))[0]).toMatchObject({
      kind: "halt_closed",
    });
  });

  it("7. reports a newly crossed threshold, naming the ticket", () => {
    const after = snapshot({ taken_at: T1, thresholds_crossed: ["page1:in_factory_4h"] });
    const events = computeEvents(snapshot(), after);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "threshold_crossed",
      page_id: "page1",
      detail: "in_factory_4h",
      name: "Send quote from the job page",
    });
  });

  it("7. re-fires a threshold after the ticket leaves and re-enters the state", () => {
    // The crossing id is dropped while the ticket is elsewhere, and computed
    // again from the NEW status_since when it comes back. So the set difference
    // sees it as new, which is what "re-fires only after the ticket leaves and
    // re-enters" means.
    const crossed = snapshot({ thresholds_crossed: ["page1:in_factory_4h"] });
    const left = snapshot({
      taken_at: T1,
      tickets: { page1: ticket({ status: "Previewed" }) },
      thresholds_crossed: [],
    });
    const backAndStale = snapshot({
      taken_at: T1,
      thresholds_crossed: ["page1:in_factory_4h"],
    });

    expect(computeEvents(crossed, left).map((e) => e.kind)).toContain("status_transition");
    expect(computeEvents(left, backAndStale).map((e) => e.kind)).toContain("threshold_crossed");
  });

  it("8. reports a QA rejection count increment", () => {
    const after = snapshot({ taken_at: T1, tickets: { page1: ticket({ qa_rejections: 1 }) } });
    const events = computeEvents(snapshot(), after);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "qa_rejection", from: "0", to: "1" });
  });

  it("8. does not report a rejection count that goes down", () => {
    // It cannot legitimately: rejections are counted from an append-only event
    // history. A decrease means the event window slid, not that a rejection was
    // undone, and reporting it would be reporting an artefact of our own paging.
    const before = snapshot({ tickets: { page1: ticket({ qa_rejections: 2 }) } });
    const after = snapshot({ taken_at: T1, tickets: { page1: ticket({ qa_rejections: 1 }) } });
    expect(computeEvents(before, after)).toEqual([]);
  });

  it("9. reports factory_idle flipping", () => {
    const idle = snapshot({ taken_at: T1, factory_idle: true });
    expect(computeEvents(snapshot(), idle)[0]).toMatchObject({
      kind: "factory_idle_flip",
      to: "true",
    });
  });

  it("10. reports each new Notion health finding once", () => {
    const after = snapshot({
      taken_at: T1,
      notion_health: {
        null_title_rows: 1,
        unknown_status_values: ["Doing"],
        unknown_module_values: ["quots"],
        unlinked: 0,
      },
    });
    const events = computeEvents(snapshot(), after);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.kind === "notion_health")).toBe(true);
    expect(events.map((e) => e.detail)).toEqual([
      "null-title rows 0 → 1",
      'unknown Status value "Doing"',
      'unknown Module value "quots"',
    ]);
  });
});

describe("the live-checks lane — the supervisor's only view of production", () => {
  // Everything else the supervisor reads is about the factory's own machinery:
  // ticket status, main CI, previews, halts. A production regression that no
  // ticket touches is invisible to all of it. On 31 Aug a SECURITY DEFINER
  // function callable by `anon` had been live for weeks with every gate green,
  // and nothing in the factory was looking. This is the one signal that would
  // have carried it.
  const live = (over: Partial<Snapshot["live_checks"]> = {}) =>
    snapshot({
      taken_at: T1,
      live_checks: {
        state: "green",
        run_url: "https://example.invalid/live/2",
        completed_at: T1,
        stale: false,
        ...over,
      },
    });

  it("reports the lane going red — production is wrong, not the tree", () => {
    const events = computeEvents(snapshot(), live({ state: "red" }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "live_checks_flip",
      from: "green",
      to: "red",
      url: "https://example.invalid/live/2",
    });
  });

  it("reports the lane recovering", () => {
    const red = snapshot({
      live_checks: { state: "red", run_url: null, completed_at: T0, stale: false },
    });
    expect(computeEvents(red, live())[0]).toMatchObject({
      kind: "live_checks_flip",
      from: "red",
      to: "green",
    });
  });

  it("reports the lane having STOPPED RUNNING, which green would hide", () => {
    // The lane's own header: "a check with no runner has quietly stopped
    // existing, which is worse than one that fails". An absent answer is not a
    // passing one, so staleness is its own event rather than folded into state.
    const events = computeEvents(snapshot(), live({ stale: true }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "live_checks_stale", to: "true" });
  });

  it("reports the lane starting to run again", () => {
    const wasStale = snapshot({
      live_checks: { state: "green", run_url: null, completed_at: T0, stale: true },
    });
    expect(computeEvents(wasStale, live())[0]).toMatchObject({
      kind: "live_checks_stale",
      to: "false",
    });
  });

  it("does not re-announce a lane that has been stale for a week", () => {
    const stale = { state: "green" as const, run_url: null, completed_at: T0, stale: true };
    expect(computeEvents(snapshot({ live_checks: stale }), live({ ...stale }))).toEqual([]);
  });

  it("does not treat a run still in progress as a flip", () => {
    // `pending` is a waypoint to both outcomes, exactly as for main CI.
    const pending = live({ state: "pending" });
    expect(computeEvents(snapshot(), pending)).toEqual([]);
    expect(computeEvents(pending, snapshot({ taken_at: T1 }))).toEqual([]);
  });

  it("says nothing while the lane stays green — a quiet hour is silent", () => {
    expect(computeEvents(snapshot(), live())).toEqual([]);
  });
});

describe("the idempotency key", () => {
  it("is the previous snapshot's taken_at, so two runs on one baseline agree", () => {
    // Hard constraint 3. A manual dispatch alongside the cron reads the same
    // previous snapshot, so both compute the same key and the second run
    // recognises the digest as already published.
    expect(idempotencyKey(snapshot())).toBe(T0);
    expect(idempotencyKey(snapshot({ taken_at: T1 }))).toBe(T1);
  });

  it("is a fixed sentinel on the first run rather than undefined", () => {
    expect(idempotencyKey(null)).toBe("genesis");
  });
});
