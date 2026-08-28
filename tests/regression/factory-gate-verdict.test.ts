import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { classifyGate } from "../../scripts/factory/gate-verdict.mjs";

// #283: "A cancelled gate run is read as a red gate, so a second push blocks
// the item." #257 was marked blocked with "CI is red on 59adc3a — not handing
// this to QA", when the run had been CANCELLED by the concurrency group
// because a second commit landed twenty seconds later. Every check passed on
// the head that mattered.
//
// The distinction this file pins is between hearing "no" and not hearing.

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  headSha: "aaa",
  status: "completed",
  conclusion: "success",
  databaseId: 1,
  ...over,
});

describe("classifyGate", () => {
  it("is green when the run for this commit succeeded", () => {
    expect(classifyGate({ runs: [run()], sha: "aaa" }).kind).toBe("green");
  });

  it("is red on a genuine failure", () => {
    const verdict = classifyGate({ runs: [run({ conclusion: "failure" })], sha: "aaa" });
    expect(verdict.kind).toBe("red");
    expect(verdict).toMatchObject({ conclusion: "failure" });
  });

  it("is red on a timeout, which is a real answer about the code", () => {
    expect(classifyGate({ runs: [run({ conclusion: "timed_out" })], sha: "aaa" }).kind).toBe("red");
  });

  it("ignores runs belonging to another commit", () => {
    // A green run from an earlier commit is not evidence about this one — that
    // is how a red branch would sail through. The claim is that it does not
    // become a pass; `pending` (keep waiting for this commit's own run) is the
    // right answer, and the caller's timeout decides if none ever arrives.
    const runs = [run({ headSha: "bbb", conclusion: "success" })];
    expect(classifyGate({ runs, sha: "aaa", head: "aaa" }).kind).not.toBe("green");
    expect(classifyGate({ runs, sha: "aaa", head: "aaa" }).kind).toBe("pending");
  });

  describe("a cancelled run", () => {
    it("is NOT red — this is #283", () => {
      const verdict = classifyGate({ runs: [run({ conclusion: "cancelled" })], sha: "aaa", head: "aaa" });
      expect(verdict.kind).not.toBe("red");
      expect(verdict.kind).toBe("no-verdict");
    });

    it("reports that it says nothing about the code, rather than that CI failed", () => {
      const verdict = classifyGate({ runs: [run({ conclusion: "cancelled" })], sha: "aaa", head: "aaa" });
      expect(verdict).toMatchObject({ kind: "no-verdict" });
      if (verdict.kind !== "no-verdict") throw new Error("expected no-verdict");
      expect(verdict.reason).toContain("says nothing about the code");
      expect(verdict.reason).not.toMatch(/\bred\b/);
    });

    it("is superseded when the branch head has moved past this commit", () => {
      // The #257 shape exactly: the run for 59adc3a was cancelled because
      // 1b923a1 landed. Blocking on a commit nobody will merge is the false
      // block; waiting is equally wrong, since no run will ever arrive for it.
      const runs = [run({ headSha: "59adc3a", conclusion: "cancelled" })];
      const verdict = classifyGate({ runs, sha: "59adc3a", head: "1b923a1" });
      expect(verdict).toEqual({ kind: "superseded", head: "1b923a1" });
    });

    it("loses to a re-run of the same commit whatever the list order", () => {
      const cancelledFirst = [
        run({ conclusion: "cancelled", databaseId: 2 }),
        run({ conclusion: "success", databaseId: 1 }),
      ];
      expect(classifyGate({ runs: cancelledFirst, sha: "aaa" })).toMatchObject({ kind: "green" });

      const successFirst = [
        run({ conclusion: "success", databaseId: 2 }),
        run({ conclusion: "cancelled", databaseId: 1 }),
      ];
      expect(classifyGate({ runs: successFirst, sha: "aaa" })).toMatchObject({ kind: "green" });
    });

    it("still surfaces a real failure that sits beside a cancellation", () => {
      // Decisive beats indecisive, but it must not invent a pass: a cancelled
      // run next to a failed one is still a failure.
      const runs = [run({ conclusion: "cancelled", databaseId: 2 }), run({ conclusion: "failure", databaseId: 1 })];
      expect(classifyGate({ runs, sha: "aaa" })).toMatchObject({ kind: "red", conclusion: "failure" });
    });
  });

  describe("still waiting", () => {
    it("is pending while a run for this commit has not completed", () => {
      expect(classifyGate({ runs: [run({ status: "in_progress", conclusion: null })], sha: "aaa" }).kind).toBe(
        "pending",
      );
    });

    it("is pending when a re-run is queued behind a cancellation", () => {
      const runs = [
        run({ status: "queued", conclusion: null, databaseId: 2 }),
        run({ conclusion: "cancelled", databaseId: 1 }),
      ];
      expect(classifyGate({ runs, sha: "aaa", head: "aaa" }).kind).toBe("pending");
    });

    it("prefers a decisive completed run over a still-running one", () => {
      const runs = [
        run({ status: "in_progress", conclusion: null, databaseId: 2 }),
        run({ conclusion: "failure", databaseId: 1 }),
      ];
      expect(classifyGate({ runs, sha: "aaa" }).kind).toBe("red");
    });
  });

  describe("nothing to read", () => {
    it("is PENDING when no run exists yet, so a caller keeps waiting", () => {
      // The caller polls immediately after pushing, when GitHub has usually not
      // created the run yet. Returning a verdict here would block every item on
      // its first poll. The caller's own timeout is what turns a run that never
      // arrives into a decision, and it already has a message for that.
      expect(classifyGate({ runs: [], sha: "aaa", head: "aaa" }).kind).toBe("pending");
    });

    it("never reports an absent run as a pass", () => {
      expect(classifyGate({ runs: [], sha: "aaa", head: "aaa" }).kind).not.toBe("green");
    });

    it("is superseded, not pending, when nothing ran and the head has moved", () => {
      // Waiting forever for a commit nobody will merge is the other way to
      // stall an item.
      expect(classifyGate({ runs: [], sha: "aaa", head: "bbb" })).toEqual({
        kind: "superseded",
        head: "bbb",
      });
    });

    it("refuses to guess at a conclusion it does not model", () => {
      const verdict = classifyGate({ runs: [run({ conclusion: "something_new" })], sha: "aaa", head: "aaa" });
      expect(verdict.kind).toBe("no-verdict");
      if (verdict.kind !== "no-verdict") throw new Error("expected no-verdict");
      expect(verdict.reason).toContain("does not model");
    });

    it("never reads skipped as a failure", () => {
      expect(classifyGate({ runs: [run({ conclusion: "skipped" })], sha: "aaa", head: "aaa" }).kind).not.toBe(
        "red",
      );
    });
  });
});

// A classifier nothing calls is decoration. #283's defect was in the workflows,
// so what has to hold is that they stage it and read its verdict.
describe("the workflows use it", () => {
  const workflows = {
    engineer: readFileSync(".github/workflows/factory-engineer.yml", "utf8"),
    qa: readFileSync(".github/workflows/factory-qa.yml", "utf8"),
  };

  for (const [name, yaml] of Object.entries(workflows)) {
    it(`${name} stages the classifier`, () => {
      expect(yaml).toContain("scripts/factory/gate-verdict.mjs > /tmp/gate-verdict.mjs");
    });

    it(`${name} stages it tolerantly, so a missing file cannot block every item`, () => {
      // The staging step runs under `bash -e`. A bare `git show` for a path
      // main does not have aborts it, which turns a renamed helper into a
      // factory-wide outage — the workflow says so itself about the attributor.
      const line = yaml
        .split("\n")
        .find((l) => l.includes("gate-verdict.mjs > /tmp/gate-verdict.mjs"));
      expect(line).toBeDefined();
      expect(line).toContain("|| true");
    });

    it(`${name} acts on the verdict rather than on the raw conclusion`, () => {
      expect(yaml).toContain("/tmp/gate-verdict.mjs /tmp/gate-runs.json");
      expect(yaml).toContain("superseded");
      expect(yaml).toContain("no-verdict");
    });

    it(`${name} still has a path when the classifier is absent`, () => {
      // Degrading to today's behaviour beats dying.
      expect(yaml).toContain('if [ -z "$VERDICT" ] && [ "$STATUS" = "completed" ]; then break; fi');
    });
  }

  it("passes the branch head, not only the commit under test", () => {
    // #283: the workflow judged 59adc3a while the branch was already at
    // 1b923a1, so even a genuine failure would have been the wrong question.
    for (const yaml of Object.values(workflows)) {
      expect(yaml).toContain('git ls-remote origin "refs/heads/$BRANCH"');
    }
  });
});
