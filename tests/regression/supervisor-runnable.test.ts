/**
 * The supervisor's entry points, invoked end to end.
 *
 * AGENTS.md's rule: a runnable deliverable must be RUN by its tests, not merely
 * imported. Two money backfills shipped as library functions with no working
 * entry point, every gate green, and one of them is live on production with no
 * caller. Importing `computeEvents` and asserting on its return value is
 * satisfied by a library function — so that is what gets built unless something
 * asks whether the command in the workflow actually runs.
 *
 * Each test here shells out to the exact command `.github/workflows/
 * factory-supervisor.yml` runs, and reads the file it was supposed to write.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { fixForwardOutcomes } from "../../scripts/supervisor/outcomes";
import type { ChangeEvent, Snapshot } from "../../scripts/supervisor/types";

const dir = mkdtempSync(join(tmpdir(), "supervisor-e2e-"));

/** Runs a script the way the workflow does, returning stdout. */
function run(script: string, args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("npx", ["tsx", `scripts/supervisor/${script}`, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      // No GitHub or Notion credentials: these three scripts are file-in,
      // file-out by design, and a test that needed live credentials would be a
      // test that never runs in CI.
      env: { ...process.env, FACTORY_TOKEN: "", GH_TOKEN: "", GITHUB_TOKEN: "", NOTION_API_KEY: "" },
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: `${e.stdout ?? ""}${e.stderr ?? ""}`, status: e.status ?? 1 };
  }
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    taken_at: "2026-08-31T09:00:00.000Z",
    main: { sha: "aaaaaaa", ci: "green", run_url: null },
    tickets: {
      page1: {
        db: "roadmap",
        name: "Send quote from the job page",
        status: "In factory",
        module: "quotes",
        status_since: "2026-08-31T08:00:00.000Z",
        issue: 481,
        pr: null,
        preview_url: null,
        preview_status: "ready",
        halt_open: false,
        qa_rejections: 0,
      },
    },
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

function write(name: string, contents: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  return path;
}

afterAll(() => {
  // The temp directory is small and the OS reclaims it; nothing to do.
});

describe("scripts/supervisor/diff.ts, invoked", () => {
  it("writes an empty event list for an unchanged pair, and exits 0", () => {
    const previous = write("prev-quiet.json", snapshot());
    const current = write(
      "cur-quiet.json",
      snapshot({ taken_at: "2026-08-31T10:00:00.000Z" }),
    );
    const out = join(dir, "events-quiet.json");

    const result = run("diff.ts", ["--previous", previous, "--current", current, "--out", out]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 change event(s)");

    const parsed = JSON.parse(readFileSync(out, "utf8")) as { events: ChangeEvent[]; key: string };
    expect(parsed.events).toEqual([]);
    // The idempotency key is written for the workflow's duplicate check.
    expect(parsed.key).toBe("2026-08-31T09:00:00.000Z");
  });

  it("writes the transition for a changed pair", () => {
    const previous = write("prev-moved.json", snapshot());
    const current = write(
      "cur-moved.json",
      snapshot({
        taken_at: "2026-08-31T10:00:00.000Z",
        tickets: { page1: { ...snapshot().tickets.page1, status: "Previewed" } },
      }),
    );
    const out = join(dir, "events-moved.json");

    const result = run("diff.ts", ["--previous", previous, "--current", current, "--out", out]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 change event(s)");

    const parsed = JSON.parse(readFileSync(out, "utf8")) as { events: ChangeEvent[] };
    expect(parsed.events[0]).toMatchObject({
      kind: "status_transition",
      from: "In factory",
      to: "Previewed",
    });
  });

  it("treats an absent previous snapshot as a first run rather than failing", () => {
    const current = write("cur-first.json", snapshot());
    const out = join(dir, "events-first.json");

    const result = run("diff.ts", [
      "--previous",
      join(dir, "does-not-exist.json"),
      "--current",
      current,
      "--out",
      out,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 change event(s)");
  });
});

describe("scripts/supervisor/metrics.ts, invoked", () => {
  it("writes every metric M1 names, from a snapshot history directory", () => {
    const history = mkdtempSync(join(tmpdir(), "supervisor-history-"));
    writeFileSync(
      join(history, "20260831T080000Z.json"),
      JSON.stringify(snapshot({ taken_at: "2026-08-31T08:00:00.000Z" })),
    );
    writeFileSync(
      join(history, "20260831T090000Z.json"),
      JSON.stringify(snapshot()),
    );

    const out = join(dir, "metrics.md");
    const result = run("metrics.ts", ["--snapshots", history, "--out", out]);

    expect(result.status).toBe(0);

    const markdown = readFileSync(out, "utf8");
    expect(markdown).toContain("Items completed without a halt");
    expect(markdown).toContain("QA rejection rate");
    expect(markdown).toContain("7-day revert / fix-forward rate");
    expect(markdown).toContain("Escape rate");
    expect(markdown).toContain("Median `Ready for factory` → `Previewed`");
    expect(markdown).toContain("Halts opened");
  });

  it("reports a CAPABILITY FAULT rather than inventing a baseline from no history", () => {
    const result = run("metrics.ts", ["--snapshots", join(dir, "no-such-dir")]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("CAPABILITY FAULT");
  });
});

describe("scripts/supervisor/retro.ts, invoked", () => {
  it("files nothing and says so when no pattern reaches three instances", () => {
    const outcomes = write("outcomes-thin.json", [
      { id: "revert:a", type: "revert", ticket: "1", pr: null, date: "2026-08-30", artefact: "a", detail: "typecheck" },
      { id: "revert:b", type: "revert", ticket: "2", pr: null, date: "2026-08-30", artefact: "b", detail: "typecheck" },
    ]);
    const retroOut = join(dir, "retro-thin.md");
    const findingsOut = join(dir, "findings-thin.json");

    const result = run("retro.ts", [
      "--outcomes", outcomes,
      "--out", retroOut,
      "--findings-out", findingsOut,
    ]);

    expect(result.status).toBe(0);
    expect(readFileSync(retroOut, "utf8")).toMatch(/No pattern reached three instances/);
    expect(JSON.parse(readFileSync(findingsOut, "utf8"))).toEqual([]);
  });

  it("emits a finding, with its citations and routing, at three instances", () => {
    const outcomes = write(
      "outcomes-thick.json",
      ["a", "b", "c"].map((k) => ({
        id: `revert:${k}`,
        type: "revert",
        ticket: "1",
        pr: null,
        date: "2026-08-30",
        artefact: k,
        detail: "typecheck failure in the acceptance test",
      })),
    );
    const retroOut = join(dir, "retro-thick.md");
    const findingsOut = join(dir, "findings-thick.json");

    const result = run("retro.ts", [
      "--outcomes", outcomes,
      "--out", retroOut,
      "--findings-out", findingsOut,
    ]);

    expect(result.status).toBe(0);

    const filed = JSON.parse(readFileSync(findingsOut, "utf8")) as { title: string; citations: string[] }[];
    expect(filed).toHaveLength(1);
    expect(filed[0].citations).toHaveLength(3);
    expect(filed[0].title).toBe("[retro] typecheck failures → CI check / lint");
  });
});

describe("scripts/supervisor/outcomes.ts, invoked", () => {
  it("runs against this repository's git history and emits a table", () => {
    // The git-derived sources (reverts, fix-forwards) need no credentials, so
    // this exercises the real entry point against the real repository. The
    // GitHub-derived sources need a token, and the script reports a CAPABILITY
    // FAULT for them rather than returning a quietly partial dataset — either
    // outcome proves the command runs.
    const out = join(dir, "outcomes.json");
    const result = run("outcomes.ts", ["--since", "2026-08-01", "--out", out]);

    if (result.status === 0) {
      const rows = JSON.parse(readFileSync(out, "utf8")) as { id: string; artefact: string }[];
      // R1's AC: no row without a concrete artefact behind it.
      for (const row of rows) expect(row.artefact.trim().length).toBeGreaterThan(0);
      expect(result.stdout).toContain("outcome(s) since 2026-08-01");
    } else {
      expect(result.stdout).toContain("CAPABILITY FAULT");
    }
  });
});

describe("scripts/supervisor/publish.ts, invoked", () => {
  it("refuses to publish a digest with zero events, naming D8", () => {
    // The gate lives in the workflow, and this is the backstop for it. A model
    // handed nothing to summarise writes a summary anyway.
    const snap = write("pub-snapshot.json", snapshot());
    const events = write("pub-events.json", { key: "k", events: [] });
    const digest = write("pub-digest.md", "## Broken\n- nothing\n");

    const result = run("publish.ts", [
      "--snapshot", snap,
      "--events", events,
      "--digest", digest,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("zero change events");
    expect(result.stdout).toContain("D8");
  });
});

describe("R1 — the fix-forward detector, against this repository's real history", () => {
  it("finds fix-forwards at all", () => {
    // It could not, until it was run. `git show --name-only` prints NOTHING for
    // a merge commit unless told which parent to diff against, so every overlap
    // check compared against an empty set and the function returned [] on every
    // input — while typechecking, linting, exiting 0 and looking finished.
    expect(fixForwardOutcomes("2026-08-01").length).toBeGreaterThan(0);
  });

  it("emits one row per repairing commit, never one per commit it overlapped", () => {
    // A single fix can overlap several earlier integrations. A row for each
    // would hand R2 three "instances" that are one commit, which is the one way
    // the ≥3 citation bar can be cleared without three things having happened.
    const rows = fixForwardOutcomes("2026-08-01");
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("does not call two commits a repair because both appended to the decision ledger", () => {
    // AGENTS.md requires an `areas/motko.md` append in the same commit as any
    // decision, so nearly every item touches it. Counting that as overlap made
    // 16 rows out of 5 real ones, and the extra 11 were pairs of unrelated
    // items that had each recorded a decision.
    for (const row of fixForwardOutcomes("2026-08-01")) {
      expect(row.detail).not.toMatch(/areas\/motko\.md/);
    }
  });

  it("gives every row a non-empty artefact, per R1's acceptance criterion", () => {
    for (const row of fixForwardOutcomes("2026-08-01")) {
      expect(row.artefact).toMatch(/^[0-9a-f]{12}->[0-9a-f]{12}$/);
    }
  });
});
