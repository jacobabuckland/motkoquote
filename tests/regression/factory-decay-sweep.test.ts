import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractFailures,
  renderDecayReport,
  trimDetails,
  type BranchDecay,
} from "@/../scripts/factory/decay-sweep";

const decay = (over: Partial<BranchDecay> = {}): BranchDecay => ({
  branch: "factory/188",
  issue: "188",
  kind: "acceptance-failure",
  details: ["AssertionError: expected 3 to be 4"],
  ...over,
});

describe("the decay report", () => {
  it("says plainly when nothing has decayed, and why a branch cannot see this itself", () => {
    const out = renderDecayReport([decay({ kind: "ok", details: [] })], "main");
    expect(out).toContain("Nothing has decayed");
    expect(out).toContain("reviews against its merge base");
  });

  it("leads with the count and states that the branches did not change", () => {
    const out = renderDecayReport([decay(), decay({ kind: "ok", branch: "factory/2", issue: "2" })], "main");
    expect(out).toContain("1 of 2 branch(es)");
    expect(out).toContain("None of them has changed");
  });

  // The whole value is repairing seven at once instead of seven at a cycle
  // each, so the report has to group them rather than list one per comment.
  it("groups every branch by what broke, worst first", () => {
    const out = renderDecayReport(
      [
        decay({ branch: "factory/1", issue: "1", kind: "acceptance-failure" }),
        decay({ branch: "factory/2", issue: "2", kind: "typecheck" }),
        decay({ branch: "factory/3", issue: "3", kind: "merge-conflict" }),
        decay({ branch: "factory/4", issue: "4", kind: "no-merge-base" }),
      ],
      "main",
    );
    const order = [
      "No merge base with main",
      "Will not merge with main",
      "Typecheck broken by main",
      "Acceptance assertions broken by main",
    ].map((t) => out.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("carries each branch's own failing detail, not just its name", () => {
    const out = renderDecayReport(
      [decay({ details: ["AssertionError: expected 3 to be 4", "  at line 12"] })],
      "main",
    );
    expect(out).toContain("expected 3 to be 4");
    expect(out).toContain("#188");
  });

  it("lists the branches that are still green, so the report is a full picture", () => {
    const out = renderDecayReport(
      [decay(), decay({ branch: "factory/9", issue: "9", kind: "ok", details: [] })],
      "main",
    );
    expect(out).toContain("Still green");
    expect(out).toContain("factory/9");
  });

  it("says a frozen file is repaired by hand rather than by another agent run", () => {
    const out = renderDecayReport([decay()], "main");
    expect(out).toContain("FIRST commit");
    expect(out).toContain("the Engineer cannot reach them");
  });

  it("never renders an empty block when a check produced no detail", () => {
    const out = renderDecayReport([decay({ details: [] })], "main");
    expect(out).toContain("_No detail captured._");
  });
});

describe("pulling the failure out of a run", () => {
  it("finds assertion failures and drops the noise around them", () => {
    const out = extractFailures(
      [
        "RUN v4.1.10",
        " FAIL  tests/acceptance/188.test.ts > does a thing",
        "AssertionError: expected 3 to be 4",
        "Duration 500ms",
      ].join("\n"),
    );
    expect(out.join("\n")).toContain("AssertionError");
    expect(out.join("\n")).not.toContain("Duration");
  });

  it("finds type errors", () => {
    const out = extractFailures("tests/acceptance/240.test.ts(214,38): error TS2345: nope");
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("TS2345");
  });

  it("strips terminal colour so the report is readable in a comment", () => {
    expect(extractFailures("[31mAssertionError: red[0m")[0]).not.toContain("[31m");
  });

  it("returns nothing rather than guessing when it recognises no failure", () => {
    expect(extractFailures("all good here")).toEqual([]);
  });

  it("caps the excerpt and truncates a runaway line", () => {
    expect(trimDetails(Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"))).toHaveLength(12);
    expect(trimDetails("x".repeat(500))[0]).toHaveLength(201);
  });
});

describe("the runtime plumbing", () => {
  const wf = readFileSync(".github/workflows/factory-decay-sweep.yml", "utf8");

  it("runs the script this module lives in", () => {
    expect(wf).toContain("npx tsx scripts/factory/decay-sweep.ts");
  });

  it("fires whenever main moves, which is the only time decay can start", () => {
    expect(wf).toMatch(/push:\s*\n\s*branches: \[main\]/);
  });

  it("checks out full history, since every branch is merged with main", () => {
    expect(wf).toContain("fetch-depth: 0");
  });

  it("reports into the same tracker the decisions digest uses", () => {
    const digest = readFileSync(".github/workflows/factory-decisions-digest.yml", "utf8");
    const tracker = /TRACKER: "(\d+)"/.exec(digest)?.[1];
    expect(tracker).toBeDefined();
    expect(wf).toContain(`TRACKER: "${tracker}"`);
  });

  // A sweep that silently produces nothing is indistinguishable from a sweep
  // that found nothing, and only one of those is good news.
  it("fails loudly if it produces no report at all", () => {
    expect(wf).toContain("The sweep produced no report");
  });

  it("keeps its scratch worktrees out of the tree", () => {
    expect(readFileSync(".gitignore", "utf8")).toContain(".decay-sweep/");
  });
});
