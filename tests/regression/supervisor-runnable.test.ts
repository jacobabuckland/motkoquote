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

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ChangeEvent, Snapshot } from "../../scripts/supervisor/types";

/**
 * These tests spawn `npx tsx` — that is the point of them, per AGENTS.md's rule
 * that a runnable deliverable must be RUN rather than imported. Process startup
 * alone is a couple of seconds, and vitest's 5s default leaves no margin once a
 * command does real work against a full-history checkout. It timed out in CI
 * while passing locally, on a shallow clone where the command exited early.
 *
 * Raised deliberately, and only after the underlying cost was fixed: the
 * fix-forward detector used to spawn two git processes PER COMMIT and now makes
 * one call for the whole window. This covers interpreter startup, not slow code.
 *
 * 30_000 was still too tight, and it failed as a FLAKE — red on a loaded runner,
 * green on a rerun, on branches touching none of this. The whole file runs in
 * ~16s on an idle machine against a 30s per-test budget, so a runner two or
 * three times slower puts a single `npx tsx` spawn over the line. A flake on a
 * shared gate is worse than a slow gate: it teaches everyone to rerun rather
 * than read, which is the habit that lets a real failure through.
 *
 * Note what is NOT done here: the timeout is a budget for interpreter startup,
 * not an assertion, so raising it weakens nothing. Every test still has to pass.
 */
vi.setConfig({ testTimeout: 120_000 });

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
    live_checks: {
      state: "green",
      run_url: null,
      completed_at: "2026-08-31T09:00:00.000Z",
      stale: false,
    },
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

  it("reports a CAPABILITY FAULT when the history directory does not exist", () => {
    // A path that points nowhere is a misconfiguration. Reported as a fault
    // because the alternative — rendering "baseline pending" — would look like
    // a healthy new install for ever.
    const result = run("metrics.ts", ["--snapshots", join(dir, "no-such-dir")]);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("CAPABILITY FAULT");
  });

  it("reports a pending baseline, NOT a fault, when the directory is empty", () => {
    // The first live supervisor run failed here. The retro fires on the first
    // Monday run, and on that run factory-state has just been created, so its
    // history directory is legitimately empty. Throwing failed the whole run
    // over a condition that resolves itself after one snapshot — and would have
    // failed it every Monday until someone worked out why.
    const empty = mkdtempSync(join(tmpdir(), "supervisor-empty-history-"));
    const out = join(dir, "metrics-pending.md");

    const result = run("metrics.ts", ["--snapshots", empty, "--out", out]);

    expect(result.status).toBe(0);
    const markdown = readFileSync(out, "utf8");
    expect(markdown).toContain("baseline pending");
    expect(markdown).toContain("Nothing is wrong");
    // And emphatically not a plausible-looking table of zeroes.
    expect(markdown).not.toContain("QA rejection rate");
  });

  it("reports a pending baseline with only one snapshot, since a rate needs two", () => {
    const one = mkdtempSync(join(tmpdir(), "supervisor-one-snapshot-"));
    writeFileSync(join(one, "20260831T080000Z.json"), JSON.stringify(snapshot()));
    const out = join(dir, "metrics-one.md");

    const result = run("metrics.ts", ["--snapshots", one, "--out", out]);

    expect(result.status).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("1 snapshot recorded");
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

describe("R1 — the fix-forward detector, against a repository built for the purpose", () => {
  /**
   * A synthetic repository, not this one.
   *
   * The first version of these tests asserted that the detector finds at least
   * one fix-forward in motkoquote's own recent history. It passed locally and
   * failed in the gate — not flakily, but for a real reason: `outcomes.ts`
   * walked the LOCAL branch name `main`, which exists on a developer's clone
   * and does not exist in an Actions checkout. Every git-derived source
   * returned zero rows.
   *
   * Two lessons, and the second is the one worth keeping. The detector needed
   * fixing — it now resolves the trunk ref and refuses a shallow clone loudly,
   * because zero outcomes is otherwise indistinguishable from a quiet week. And
   * the test needed rewriting: an assertion about what happens to be in a real
   * repository's last month is an assertion about data, not behaviour. It
   * breaks on a shallow clone, on a quiet month, and on a squash policy change.
   *
   * So the history is constructed here. Every assertion below is deterministic
   * and would have failed on the original bug just the same.
   */
  const repo = mkdtempSync(join(tmpdir(), "supervisor-fixforward-"));

  const run = (args: string[]) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const commit = (message: string, files: Record<string, string>, date: string) => {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(repo, name), body);
    }
    run(["add", "-A"]);
    // BOTH dates. `--date` sets only the author date, and `git log --since` /
    // `--until` filter on the COMMITTER date — so setting one leaves the other
    // at "now", and every window assertion below silently matches nothing.
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@e.invalid",
       "commit", "-m", message, "--date", date],
      { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_COMMITTER_DATE: date } },
    );
  };

  beforeAll(() => {
    run(["init", "--initial-branch=main", "-q"]);
    // A feature lands, then a commit whose subject says "fix" touches one of the
    // same files three days later. That is the shape the detector looks for.
    commit("feat(quotes): add the send button (#100)", {
      "send.ts": "one",
      "unrelated.ts": "x",
    }, "2026-08-01T10:00:00Z");
    commit("fix: the send button double-fired (#101)", {
      "send.ts": "two",
    }, "2026-08-04T10:00:00Z");
    // A later feature touching a different file, with no repair after it.
    commit("feat(invoices): mark as paid (#102)", { "invoices.ts": "one" }, "2026-08-10T10:00:00Z");
  });

  type Outcome = { id: string; detail: string; artefact: string };

  /**
   * Runs the detector with its cwd and trunk pointed at the synthetic repo.
   *
   * Memoised by window, because three of the tests below ask for the SAME
   * window and each spawn was a fresh `npx tsx`. The repository is built once
   * in beforeAll and never mutated, so a second spawn on the same `since` can
   * only reproduce the first — it was paying interpreter startup to recompute
   * a constant. Two spawns for this block now instead of five.
   */
  const cache = new Map<string, Outcome[]>();
  const detect = (since: string): Outcome[] => {
    const hit = cache.get(since);
    if (hit) return hit;
    const out = execFileSync(
      "npx",
      ["tsx", "-e",
        `import {fixForwardOutcomes} from "${process.cwd()}/scripts/supervisor/outcomes.ts";` +
        `console.log(JSON.stringify(fixForwardOutcomes("${since}")));`],
      { cwd: repo, encoding: "utf8", env: { ...process.env, SUPERVISOR_TRUNK_REF: "main" } },
    );
    const rows = JSON.parse(out.trim().split("\n").pop() ?? "[]") as Outcome[];
    cache.set(since, rows);
    return rows;
  };

  it("finds the fix-forward", () => {
    // The assertion that caught the ref bug. It is meaningful here because the
    // history is constructed: there IS one to find.
    const rows = detect("2026-07-01");
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toContain("send.ts");
    expect(rows[0].detail).toContain("double-fired");
  });

  it("gives it a two-SHA artefact, so a human can check the pair", () => {
    expect(detect("2026-07-01")[0].artefact).toMatch(/^[0-9a-f]{12}->[0-9a-f]{12}$/);
  });

  it("does not invent one for a commit nothing repaired", () => {
    const rows = detect("2026-07-01");
    expect(rows.every((r) => !r.detail.includes("invoices.ts"))).toBe(true);
  });

  it("returns nothing when the window excludes the history", () => {
    expect(detect("2026-09-01")).toEqual([]);
  });

  it("resolves the trunk as origin/main when no LOCAL main exists", () => {
    // THE REGRESSION. An Actions checkout leaves the trunk available only as
    // `origin/main`; there is no local branch called `main`. The detector walked
    // the bare name, git errored, the error was swallowed, and every git-derived
    // source returned zero rows — which a retro reads as a quiet week.
    //
    // Reproduced by renaming the branch and leaving only a remote-tracking ref,
    // then running with NO SUPERVISOR_TRUNK_REF so the fallback chain is what is
    // under test.
    run(["branch", "-m", "main", "detached-trunk"]);
    run(["update-ref", "refs/remotes/origin/main", "detached-trunk"]);

    const out = execFileSync(
      "npx",
      ["tsx", "-e",
        `import {fixForwardOutcomes} from "${process.cwd()}/scripts/supervisor/outcomes.ts";` +
        `console.log(JSON.stringify(fixForwardOutcomes("2026-07-01")));`],
      { cwd: repo, encoding: "utf8", env: { ...process.env, SUPERVISOR_TRUNK_REF: "" } },
    );
    const rows = JSON.parse(out.trim().split("\n").pop() ?? "[]") as unknown[];

    expect(rows).toHaveLength(1);

    run(["branch", "-m", "detached-trunk", "main"]);
  });
});

describe("R1 — refusing to report an unreadable history as an empty one", () => {
  it("fails loudly when no trunk ref resolves, rather than returning zero rows", () => {
    // The bug this replaces did exactly the opposite: it returned [], which a
    // retro reads as a week with no reverts and no fix-forwards.
    const empty = mkdtempSync(join(tmpdir(), "supervisor-no-trunk-"));
    execFileSync("git", ["init", "--initial-branch=trunk", "-q"], { cwd: empty });

    let message = "";
    try {
      execFileSync(
        "npx",
        ["tsx", "-e",
          `import {revertOutcomes} from "${process.cwd()}/scripts/supervisor/outcomes.ts";` +
          `revertOutcomes("2026-01-01");`],
        { cwd: empty, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, SUPERVISOR_TRUNK_REF: "" } },
      );
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string };
      message = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }

    expect(message).toContain("CAPABILITY FAULT");
    expect(message).toContain("trunk ref");
  });
});
