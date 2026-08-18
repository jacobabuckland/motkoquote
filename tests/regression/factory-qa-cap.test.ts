import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CAP = "scripts/factory/qa-cap.sh";
const HEAD = "a".repeat(40);
const OLDER = "b".repeat(40);

interface Comment {
  body: string;
  created_at: string;
}
interface Event {
  event: string;
  created_at: string;
  label?: { name: string };
}

const at = (day: number): string => `2026-08-${String(day).padStart(2, "0")}T12:00:00Z`;

/** A CHANGES verdict comment raising the given criteria. */
const changes = (day: number, keys: string[], sha = HEAD): Comment => ({
  body: [
    "**QA findings** (cycle n)",
    "",
    "Some prose a human reads.",
    ...keys.map((k) => `FINDING: ${k} — something is wrong with ${k}`),
    "",
    `<!-- qa-verdict verdict=CHANGES sha=${sha} -->`,
  ].join("\n"),
  created_at: at(day),
});

/** A CHANGES verdict written before criterion keys existed. */
const legacyChanges = (day: number): Comment => ({
  body: "**QA findings** (cycle 1 of 3)\n\nprose only, no keys",
  created_at: at(day),
});

const passed = (day: number, sha = HEAD): Comment => ({
  body: `**QA passed**\n\nlooks right\n\n<!-- qa-verdict verdict=PASS sha=${sha} -->`,
  created_at: at(day),
});

/** The cap's own stop comment. */
const stopped = (day: number, key = "incomplete-implementation"): Comment => ({
  body: `**Stopped: \`${key}\` has been raised 3 times without being resolved.**\n\nprose`,
  created_at: at(day),
});

/** What the resume machinery posts when a person answers with `verify`. */
const resumedAtVerify = (day: number): Comment => ({
  body: "Resumed at `verify` from your answer above. If that was the wrong stage, the item will come back.",
  created_at: at(day),
});

const labelled = (day: number, name: string): Event => ({
  event: "labeled",
  created_at: at(day),
  label: { name },
});

function run(
  timeline: Event[],
  comments: Comment[],
  headSha = HEAD,
  ci = "success",
): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "qa-cap-"));
  const tl = join(dir, "timeline.json");
  const cm = join(dir, "comments.json");
  writeFileSync(tl, JSON.stringify(timeline));
  writeFileSync(cm, JSON.stringify(comments));
  const out = execFileSync(CAP, [tl, cm, headSha, ci], { encoding: "utf8" });
  return Object.fromEntries(
    out
      .trim()
      .split("\n")
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
}

describe("the cap counts disagreements, not rounds", () => {
  // THE REGRESSION. Four items were stopped in a single afternoon — #96, #185,
  // #195, #123 — every one of them after the Engineer had complied with the
  // findings. Under a round count, complying and being given something new to
  // do is indistinguishable from getting nowhere.
  it("does not stop an item where each cycle raised something new", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [changes(2, ["error-handling"]), changes(3, ["naming"]), changes(4, ["missing-test"])],
      HEAD,
      "failure",
    );
    expect(r.decision).toBe("proceed");
  });

  it("stops an item where one criterion keeps coming back", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [
        changes(2, ["workflow-integration-missing"]),
        changes(3, ["workflow-integration-missing", "naming"]),
        changes(4, ["workflow-integration-missing"]),
      ],
      HEAD,
      "failure",
    );
    expect(r.decision).toBe("cap");
    expect(r.cap_reason).toBe("criterion");
    expect(r.worst_criterion).toBe("workflow-integration-missing");
    expect(r.worst_count).toBe("3");
  });

  // A criterion the Engineer fixed is one QA stopped raising. It must not go on
  // counting against the item for the rest of its life.
  it("stops counting a criterion once it is no longer raised", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [
        changes(2, ["error-handling"]),
        changes(3, ["error-handling"]),
        changes(4, ["something-else"]),
      ],
      HEAD,
      "failure",
    );
    expect(r.decision).toBe("proceed");
    expect(r.worst_criterion).toBe("something-else");
    expect(r.worst_count).toBe("1");
  });

  it("counts a criterion across cycles that raised other things too", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [
        changes(2, ["scope", "a"]),
        changes(3, ["b", "scope"]),
        changes(4, ["scope", "c"]),
      ],
      HEAD,
      "failure",
    );
    expect(r.decision).toBe("cap");
    expect(r.worst_criterion).toBe("scope");
  });

  it("still stops a runaway that raises something new every time", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      Array.from({ length: 8 }, (_, i) => changes(2 + i, [`criterion-${i}`])),
      HEAD,
      "failure",
    );
    expect(r.decision).toBe("cap");
    expect(r.cap_reason).toBe("runaway");
  });
});

describe("what resets the counter", () => {
  it("is needs-spec, which genuinely restarts the item", () => {
    const r = run(
      [labelled(1, "needs-spec"), labelled(5, "needs-spec")],
      [
        changes(2, ["scope"]),
        changes(3, ["scope"]),
        changes(4, ["scope"]),
        changes(6, ["scope"]),
      ],
      HEAD,
      "failure",
    );
    expect(r.cycles).toBe("1");
    expect(r.decision).toBe("proceed");
  });

  // The dead end this replaces: anchoring to spec-derived meant sending an item
  // back to the Engineer reset the argument, and sending a COMPLETE item back
  // produces no changes, which the push step reads as a malfunction and blocks.
  // A loop with no exit.
  it("is NOT spec-derived", () => {
    const r = run(
      [labelled(1, "needs-spec"), labelled(5, "spec-derived")],
      [
        changes(2, ["scope"]),
        changes(3, ["scope"]),
        changes(6, ["scope"]),
      ],
      HEAD,
      "failure",
    );
    expect(r.cycles).toBe("3");
    expect(r.decision).toBe("cap");
  });
});

describe("the exit for a finished item", () => {
  // A finished item must never need another cycle to escape a counter.
  it("advances a passed, green item without running an agent, even when capped", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [
        changes(2, ["scope"]),
        changes(3, ["scope"]),
        changes(4, ["scope"]),
        passed(5),
      ],
      HEAD,
      "success",
    );
    expect(r.capped).toBe("true");
    expect(r.decision).toBe("exit-previewed");
  });

  it("refuses the exit when the pass was about a different commit", () => {
    const r = run([labelled(1, "needs-spec")], [passed(5, OLDER)], HEAD, "success");
    expect(r.decision).toBe("proceed");
  });

  it("refuses the exit when the gate is not green on that commit", () => {
    const r = run([labelled(1, "needs-spec")], [passed(5)], HEAD, "failure");
    expect(r.decision).toBe("proceed");
  });

  it("refuses the exit on an unstamped legacy pass, which names no commit", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [{ body: "**QA passed**\n\nno marker", created_at: at(5) }],
      HEAD,
      "success",
    );
    expect(r.latest_verdict).toBe("none");
    expect(r.decision).toBe("proceed");
  });

  it("refuses the exit when the latest verdict is CHANGES", () => {
    const r = run([labelled(1, "needs-spec")], [passed(4), changes(5, ["scope"])], HEAD, "success");
    expect(r.decision).toBe("proceed");
  });
});

describe("comments written before criterion keys existed", () => {
  it("still count as rounds, so the cap stays reachable", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [legacyChanges(2), legacyChanges(3), legacyChanges(4)],
      HEAD,
      "failure",
    );
    expect(r.decision).toBe("cap");
    expect(r.worst_criterion).toBe("unkeyed");
  });
});

describe("the runtime plumbing", () => {
  const qa = readFileSync(".github/workflows/factory-qa.yml", "utf8");

  it("the workflow materialises the cap script it calls", () => {
    expect(qa).toContain("git show origin/main:scripts/factory/qa-cap.sh");
    expect(qa).toContain("/tmp/qa-cap.sh /tmp/qa-timeline.json /tmp/qa-comments.json");
  });

  it("no step still gates on a round count", () => {
    expect(qa).not.toContain("steps.cap.outputs.cycles < 3");
    expect(qa).not.toContain("steps.cap.outputs.cycles >= 3");
  });

  it("QA is told to reuse a criterion key when it re-raises one", () => {
    expect(qa).toContain("FINDING: <key>");
    expect(qa).toContain("Reuse its key exactly");
    expect(qa).toContain("steps.cap.outputs.prior_keys");
  });

  // Requirement (c): the report must say what the escape actually is, because
  // the obvious one is the dead end.
  it("the cap message names the real escapes and rules out spec-derived", () => {
    expect(qa).toContain("The escape is not \\`spec-derived\\`");
    expect(qa).toContain("ANSWER: qa-changes");
    expect(qa).toContain("advances by itself with no agent run");
  });

  it("resume.sh warns that spec-derived on finished work is a dead end", () => {
    expect(readFileSync("scripts/factory/resume.sh", "utf8")).toContain("spec-derived");
  });
});

// THE SECOND TRAP, found live on LED-5. The cap offers "QA was wrong — ANSWER:
// verify to have it look again" as a route out, and that route did not work:
// this check runs at the top of the verify stage, so resuming there re-fired
// the cap before any reviewer looked and the item blocked again within a
// minute. The fix that QA had asked for was already pushed at the time.
describe("a person answering the cap buys exactly one review", () => {
  const threeSame = [
    changes(2, ["incomplete-implementation"]),
    changes(3, ["incomplete-implementation"]),
    changes(4, ["incomplete-implementation"]),
  ];

  it("still stops when nobody has answered", () => {
    const r = run([labelled(1, "needs-spec")], [...threeSame, stopped(5)], HEAD, "success");
    expect(r.decision).toBe("cap");
    expect(r.human_answered).toBe("false");
  });

  it("proceeds to a review once a person has answered since the stop", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [...threeSame, stopped(5), resumedAtVerify(6)],
      HEAD,
      "success",
    );
    expect(r.decision).toBe("proceed");
    expect(r.human_answered).toBe("true");
  });

  // One review, not a reset. The counter is untouched, so the same criterion
  // raised again on the corrected head stops the item a second time — which is
  // the whole point of the cap and must survive this escape hatch.
  it("does not reset the counter", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [...threeSame, stopped(5), resumedAtVerify(6)],
      HEAD,
      "success",
    );
    expect(r.capped, "still capped — the answer bought a look, not amnesty").toBe("true");
    expect(Number(r.worst_count)).toBeGreaterThanOrEqual(3);
  });

  // An answer given BEFORE the cap stopped the item says nothing about the
  // stop, so it must not unlock it.
  it("ignores a resume that predates the stop", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [resumedAtVerify(1), ...threeSame, stopped(5)],
      HEAD,
      "success",
    );
    expect(r.decision).toBe("cap");
    expect(r.human_answered).toBe("false");
  });

  // The finished-and-green exit still wins: it needs no human at all.
  it("leaves the passed-and-green exit ahead of it", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [...threeSame, stopped(5), resumedAtVerify(6), passed(7)],
      HEAD,
      "success",
    );
    expect(r.decision).toBe("exit-previewed");
  });
  // "Exactly one review" has to be true of the code, not just the comment. The
  // flag cannot simply stay set: `proceed` posts no new stop comment, so with
  // nothing to spend it there would be no second stop for a later resume to be
  // newer than, and one answer would unlock the loop permanently.
  it("is spent once a review has happened since the answer", () => {
    const r = run(
      [labelled(1, "needs-spec")],
      [...threeSame, stopped(5), resumedAtVerify(6), changes(7, ["incomplete-implementation"])],
      HEAD,
      "success",
    );
    expect(r.human_answered, "the look it bought has been taken").toBe("false");
    expect(r.decision).toBe("cap");
  });

  // An escape from one guard must never become an escape from all of them. The
  // runaway ceiling is the backstop against an item raising a brand new finding
  // every cycle forever, and no single answer may switch it off.
  it("never bypasses the runaway ceiling", () => {
    const manyDistinct = Array.from({ length: 9 }, (_, i) => changes(2 + i, [`finding-${i}`]));
    const r = run(
      [labelled(1, "needs-spec")],
      [...manyDistinct, stopped(12, "runaway"), resumedAtVerify(13)],
      HEAD,
      "success",
    );
    expect(r.cap_reason).toBe("runaway");
    expect(r.decision, "a human answer must not unlock a runaway").toBe("cap");
  });
});
