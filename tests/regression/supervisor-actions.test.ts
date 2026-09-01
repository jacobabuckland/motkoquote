/**
 * §7's constraint column, as tests.
 *
 * The spec asks for each action's constraint to be enforced by a test, and the
 * reason is that §7 is a SAFETY enumeration: the supervisor writes to a real
 * board and a real issue tracker on a schedule, with nobody watching. The
 * asymmetry runs one way — a missed action is a line in a digest someone reads
 * within the hour, and a wrong action moves a live ticket.
 *
 * The requeue cases carry the most weight. D10 and the fourth hard constraint
 * both say the supervisor reports halts and never resolves them, and requeueing
 * a blocked item is precisely how it would resolve one by accident.
 */

import { describe, expect, it } from "vitest";

import {
  bugsToFile,
  duplicateRecord,
  findDuplicates,
  mayRequeue,
  mayRetryPreview,
  requeueRecord,
  retryPreviewRecord,
} from "../../scripts/supervisor/actions-core";
import type { Snapshot, TicketSnapshot } from "../../scripts/supervisor/types";

const NOW = "2026-08-31T12:00:00.000Z";
const hoursAgo = (n: number) => new Date(Date.parse(NOW) - n * 3_600_000).toISOString();

function ticket(overrides: Partial<TicketSnapshot> = {}): TicketSnapshot {
  return {
    db: "roadmap",
    name: "A card",
    status: "In factory",
    module: "quotes",
    status_since: hoursAgo(6),
    issue: 481,
    pr: null,
    preview_url: null,
    preview_status: "unknown",
    halt_open: false,
    qa_rejections: 0,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    taken_at: NOW,
    main: { sha: "aaa", ci: "green", run_url: null },
    live_checks: {
      state: "green",
      run_url: null,
      completed_at: NOW,
      stale: false,
    },
    tickets: {},
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

describe("T1 — retry a failed preview", () => {
  it("retries a failed preview that has not been retried", () => {
    expect(mayRetryPreview("p", ticket({ preview_status: "failed" }), {}, NOW)).toBe(true);
  });

  it("does not retry a preview that has not failed", () => {
    for (const status of ["ready", "building", "unknown"] as const) {
      expect(mayRetryPreview("p", ticket({ preview_status: status }), {}, NOW)).toBe(false);
    }
  });

  it("respects the once-per-24h cooldown", () => {
    const failed = ticket({ preview_status: "failed" });
    expect(mayRetryPreview("p", failed, { p: hoursAgo(23) }, NOW)).toBe(false);
    expect(mayRetryPreview("p", failed, { p: hoursAgo(25) }, NOW)).toBe(true);
  });

  it("does not retry a ticket with no linked issue", () => {
    expect(mayRetryPreview("p", ticket({ preview_status: "failed", issue: null }), {}, NOW)).toBe(false);
  });

  it("records a reversal instruction", () => {
    expect(retryPreviewRecord("p", ticket()).reversal).toMatch(/\S/);
  });
});

describe("T2 — requeue a stalled ticket", () => {
  it("requeues an In-factory ticket idle for 4h", () => {
    expect(mayRequeue(ticket(), ["spec-derived"], hoursAgo(5), NOW)).toBe(true);
  });

  it("requeues one whose branch does not exist yet — that IS the stall", () => {
    expect(mayRequeue(ticket(), ["spec-derived"], null, NOW)).toBe(true);
  });

  it("NEVER requeues a Blocked ticket", () => {
    // §7's own words. The supervisor reports halts; it does not resolve them.
    expect(mayRequeue(ticket({ status: "Blocked" }), ["blocked"], null, NOW)).toBe(false);
  });

  it("NEVER requeues a ticket carrying any stopped label, whatever Notion says", () => {
    // The Notion status is a MIRROR, written back from the label. It can lag,
    // and a lagging mirror that still reads "In factory" is exactly when this
    // would fire wrongly — so the labels are checked, not just the status.
    for (const label of ["blocked", "qa-disputed", "spec-dispute", "reconciler-escalated"]) {
      expect(mayRequeue(ticket(), [label], null, NOW)).toBe(false);
    }
  });

  it("never requeues a ticket with an open halt", () => {
    expect(mayRequeue(ticket({ halt_open: true }), [], null, NOW)).toBe(false);
  });

  it("does not requeue before 4h have passed", () => {
    expect(mayRequeue(ticket({ status_since: hoursAgo(3) }), [], null, NOW)).toBe(false);
  });

  it("does not requeue while the branch is still receiving commits", () => {
    expect(mayRequeue(ticket(), [], hoursAgo(1), NOW)).toBe(false);
  });

  it("only applies to In factory", () => {
    for (const status of ["Backlog", "Ready for factory", "Previewed", "Shipped", "Needs spec"]) {
      expect(mayRequeue(ticket({ status }), [], null, NOW)).toBe(false);
    }
  });

  it("records a reversal instruction", () => {
    expect(requeueRecord("p", ticket()).reversal).toMatch(/\S/);
  });
});

describe("T3 — duplicates", () => {
  const createdAt = { a: hoursAgo(20), b: hoursAgo(8), c: hoursAgo(200) };

  it("finds two same-titled Backlog cards created within 24h", () => {
    const pairs = findDuplicates(
      {
        a: ticket({ name: "Fix the thing", status: "Backlog" }),
        b: ticket({ name: "Fix the thing", status: "Ready for factory" }),
      },
      createdAt,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ keep: "a", close: "b" });
  });

  it("does not pair cards created more than 24h apart", () => {
    const pairs = findDuplicates(
      {
        a: ticket({ name: "Fix the thing", status: "Backlog" }),
        c: ticket({ name: "Fix the thing", status: "Backlog" }),
      },
      createdAt,
    );
    expect(pairs).toEqual([]);
  });

  it("does not pair across databases — a bug and a roadmap item may share a title", () => {
    const pairs = findDuplicates(
      {
        a: ticket({ name: "Fix the thing", status: "Backlog", db: "roadmap" }),
        b: ticket({ name: "Fix the thing", status: "Backlog", db: "bugs" }),
      },
      createdAt,
    );
    expect(pairs).toEqual([]);
  });

  it("does not pair cards that have left the backlog", () => {
    const pairs = findDuplicates(
      {
        a: ticket({ name: "Fix the thing", status: "In factory" }),
        b: ticket({ name: "Fix the thing", status: "In factory" }),
      },
      createdAt,
    );
    expect(pairs).toEqual([]);
  });

  it("never pairs untitled rows, which would all look identical to each other", () => {
    const pairs = findDuplicates(
      {
        a: ticket({ name: "(untitled)", status: "Backlog" }),
        b: ticket({ name: "(untitled)", status: "Backlog" }),
      },
      createdAt,
    );
    expect(pairs).toEqual([]);
  });

  it("FLAGS rather than closes — the board has no closed state", () => {
    // §7 rules out `Shipped` explicitly and says "if in doubt, flag, don't
    // close". Every value the factory writes means the ticket is live
    // somewhere, so the fallback is the only branch available.
    const record = duplicateRecord({ keep: "a", close: "b", title: "Fix the thing" });
    expect(record.action).toMatch(/flagged/i);
    expect(record.reversal).toMatch(/nothing was changed/i);
  });
});

describe("T4 — file a bug", () => {
  it("files on a new null-title row", () => {
    const bugs = bugsToFile(snapshot(), snapshot({
      notion_health: {
        null_title_rows: 1,
        unknown_status_values: [],
        unknown_module_values: [],
        unlinked: 0,
      },
    }));
    expect(bugs).toHaveLength(1);
    expect(bugs[0].title).toMatch(/^\[supervisor\]/);
  });

  it("files one ticket per distinct cause", () => {
    const bugs = bugsToFile(snapshot(), snapshot({
      notion_health: {
        null_title_rows: 2,
        unknown_status_values: ["Doing", "Parked"],
        unknown_module_values: ["quots"],
        unlinked: 0,
      },
    }));
    expect(bugs.map((b) => b.key).sort()).toEqual([
      "null-title-rows",
      "unknown-module:quots",
      "unknown-status:Doing",
      "unknown-status:Parked",
    ]);
  });

  it("does not re-file a finding the previous snapshot already had", () => {
    const health = {
      null_title_rows: 1,
      unknown_status_values: ["Doing"],
      unknown_module_values: [],
      unlinked: 0,
    };
    expect(bugsToFile(snapshot({ notion_health: health }), snapshot({ notion_health: { ...health } }))).toEqual([]);
  });

  it("files on an idle factory only after TWO consecutive runs", () => {
    // One idle observation is a queue between items, and filing on it would
    // file most nights.
    expect(bugsToFile(snapshot({ factory_idle: false }), snapshot({ factory_idle: true }))).toEqual([]);
    expect(
      bugsToFile(snapshot({ factory_idle: true }), snapshot({ factory_idle: true })).map((b) => b.key),
    ).toEqual(["factory-idle"]);
  });

  it("files nothing on a first run, when there is no previous snapshot", () => {
    expect(bugsToFile(null, snapshot({ factory_idle: true }))).toEqual([]);
  });
});
