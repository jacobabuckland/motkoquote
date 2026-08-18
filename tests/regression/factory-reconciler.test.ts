import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_AUTO_REFIRES,
  STAGE_WORKFLOW,
  STALL_THRESHOLD_MINUTES,
  reconcile,
  refireKey,
  stageEnteredAt,
  type ActiveRun,
  type LabelEvent,
  type ObservedItem,
  type Stage,
} from "@/../scripts/factory/reconcile-core";
import { latestQaVerdict, parseState, runToken } from "@/../scripts/factory/reconcile";

const NOW = "2026-08-18T12:00:00Z";
const minutesAgo = (m: number): string => new Date(Date.parse(NOW) - m * 60000).toISOString();

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

function item(over: Partial<ObservedItem> = {}): ObservedItem {
  const labels = over.labels ?? ["factory", "verify"];
  const stage = labels.find((l) =>
    (["needs-spec", "spec-derived", "verify", "qa-changes"] as string[]).includes(l),
  );
  const labelEvents: LabelEvent[] =
    over.labelEvents ??
    (stage ? [{ name: stage, at: minutesAgo(10), action: "labeled" }] : []);
  const branch: ObservedItem["branch"] = Object.prototype.hasOwnProperty.call(over, "branch")
    ? (over.branch ?? null)
    : { name: "factory/900", sha: SHA };
  const branchContent: ObservedItem["branchContent"] = Object.prototype.hasOwnProperty.call(
    over,
    "branchContent",
  )
    ? (over.branchContent ?? null)
    : branch === null
      ? null
      : { hasSpec: true, hasTests: true, hasImplementation: true };

  return {
    number: 900,
    title: "An item",
    labels,
    ci: null,
    pr: null,
    qa: null,
    refires: [],
    ...over,
    branch,
    branchContent,
    labelEvents,
  };
}

const greenCi = (sha = SHA) =>
  ({ sha, status: "completed", conclusion: "success", url: "https://example.invalid/ci" }) as const;

const run = (workflow: string, status = "in_progress"): ActiveRun => ({
  workflow,
  runId: 1,
  status,
  url: "https://example.invalid/1",
});

describe("items the reconciler leaves alone", () => {
  it("skips the bookkeeping tracker", () => {
    const d = reconcile(item({ labels: ["factory", "factory-meta", "verify"] }), [], NOW);
    expect(d.kind).toBe("skip");
  });

  it("skips a stopped item, which the digest already reports", () => {
    const d = reconcile(item({ labels: ["factory", "blocked"] }), [], NOW);
    expect(d.kind).toBe("skip");
  });

  it("skips a previewed item", () => {
    const d = reconcile(item({ labels: ["factory", "previewed"] }), [], NOW);
    expect(d.kind).toBe("skip");
  });

  it("holds an item that has not yet hit the threshold", () => {
    const d = reconcile(
      item({ labelEvents: [{ name: "verify", at: minutesAgo(STALL_THRESHOLD_MINUTES - 1), action: "labeled" }] }),
      [],
      NOW,
    );
    expect(d.kind).toBe("holding");
  });
});

describe("a stage that is legitimately still running", () => {
  it("holds even when the item is far past the threshold", () => {
    const d = reconcile(
      item({ labelEvents: [{ name: "verify", at: minutesAgo(600), action: "labeled" }] }),
      [run("factory-qa.yml")],
      NOW,
    );
    expect(d.kind).toBe("holding");
  });

  it("holds a queued run that has not started a step yet", () => {
    const d = reconcile(
      item({ labelEvents: [{ name: "verify", at: minutesAgo(600), action: "labeled" }] }),
      [run("factory-qa.yml", "queued")],
      NOW,
    );
    expect(d.kind).toBe("holding");
  });

  // The case that would double-fire under branch matching. A first PM run has
  // no branch to match on and reports head_branch: main, so only the run name
  // can identify it — and a slow first spec must not get a second PM on top.
  it("holds a slow FIRST PM run, which has no branch at all", () => {
    const d = reconcile(
      item({
        labels: ["factory", "needs-spec"],
        branch: null,
        labelEvents: [{ name: "needs-spec", at: minutesAgo(120), action: "labeled" }],
      }),
      [run("factory-pm.yml")],
      NOW,
    );
    expect(d.kind).toBe("holding");
  });

  it("re-fires that same PM item once nothing is running against it", () => {
    const d = reconcile(
      item({
        labels: ["factory", "needs-spec"],
        branch: null,
        labelEvents: [{ name: "needs-spec", at: minutesAgo(120), action: "labeled" }],
      }),
      [],
      NOW,
    );
    expect(d).toMatchObject({ kind: "refire", stage: "needs-spec", workflow: "factory-pm.yml" });
  });
});

describe("re-firing a stalled stage", () => {
  it("re-fires the consumer for the stage, not the label", () => {
    const cases: [Stage, string][] = [
      ["needs-spec", "factory-pm.yml"],
      ["spec-derived", "factory-engineer.yml"],
      ["qa-changes", "factory-engineer.yml"],
      ["verify", "factory-qa.yml"],
    ];
    for (const [stage, workflow] of cases) {
      const d = reconcile(
        item({
          labels: ["factory", stage],
          // The PM stage before it has pushed anything is the no-branch case.
          branch: stage === "needs-spec" ? null : { name: "factory/900", sha: SHA },
          labelEvents: [{ name: stage, at: minutesAgo(120), action: "labeled" }],
        }),
        [],
        NOW,
      );
      expect(d).toMatchObject({ kind: "refire", stage, workflow });
    }
  });

  it("stops after the cap and escalates with a resumable stage", () => {
    const key = refireKey("verify", SHA);
    const d = reconcile(
      item({
        labelEvents: [{ name: "verify", at: minutesAgo(600), action: "labeled" }],
        refires: [{ key, count: MAX_AUTO_REFIRES, lastAt: minutesAgo(60) }],
      }),
      [],
      NOW,
    );
    expect(d.kind).toBe("escalate");
    if (d.kind !== "escalate") throw new Error("unreachable");
    expect(d.resumeStage).toBe("verify");
    expect(d.question).toContain("re-fired");
    expect(d.recommendation).toContain("nothing about the branch has changed");
  });

  // The ledger is keyed on the commit, so work landing on the branch buys the
  // item a fresh budget. Without this, one exhausted stage would poison the
  // item for the rest of its life.
  it("gives a new commit a fresh re-fire budget", () => {
    const d = reconcile(
      item({
        branch: { name: "factory/900", sha: OTHER_SHA },
        labelEvents: [{ name: "verify", at: minutesAgo(600), action: "labeled" }],
        refires: [{ key: refireKey("verify", SHA), count: MAX_AUTO_REFIRES, lastAt: minutesAgo(60) }],
      }),
      [],
      NOW,
    );
    expect(d.kind).toBe("refire");
  });
});

describe("labels the observed state contradicts", () => {
  it("advances an item QA passed on the current head but never re-labelled", () => {
    const d = reconcile(
      item({ qa: { verdict: "PASS", sha: SHA, at: minutesAgo(30) } }),
      [],
      NOW,
    );
    expect(d).toMatchObject({ kind: "correct-label", add: ["previewed"], remove: ["verify"] });
  });

  it("routes an item QA returned CHANGES on, but never re-labelled", () => {
    const d = reconcile(
      item({ qa: { verdict: "CHANGES", sha: SHA, at: minutesAgo(30) } }),
      [],
      NOW,
    );
    expect(d).toMatchObject({ kind: "correct-label", add: ["qa-changes"], remove: ["verify"] });
  });

  // The SHA gate is the whole safety of this correction: a verdict about an
  // earlier commit says nothing about the one the branch points at now.
  it("ignores a verdict about a different commit", () => {
    const d = reconcile(
      item({ qa: { verdict: "PASS", sha: OTHER_SHA, at: minutesAgo(30) } }),
      [],
      NOW,
    );
    expect(d.kind).toBe("holding");
  });

  it("ignores a legacy verdict that recorded no SHA", () => {
    const d = reconcile(
      item({ qa: { verdict: "PASS", sha: null, at: minutesAgo(30) } }),
      [],
      NOW,
    );
    expect(d.kind).toBe("holding");
  });

  it("drops the older of two stage labels, by timeline", () => {
    const d = reconcile(
      item({
        labels: ["factory", "verify", "qa-changes"],
        labelEvents: [
          { name: "verify", at: minutesAgo(90), action: "labeled" },
          { name: "qa-changes", at: minutesAgo(20), action: "labeled" },
        ],
      }),
      [],
      NOW,
    );
    expect(d).toMatchObject({ kind: "correct-label", remove: ["verify"] });
  });

  it("resolves a stage label sitting alongside blocked", () => {
    const d = reconcile(
      item({
        labels: ["factory", "verify", "blocked"],
        labelEvents: [
          { name: "blocked", at: minutesAgo(90), action: "labeled" },
          { name: "verify", at: minutesAgo(20), action: "labeled" },
        ],
      }),
      [],
      NOW,
    );
    expect(d).toMatchObject({ kind: "correct-label", remove: ["blocked"] });
  });
});

describe("nothing is stranded silently", () => {
  it("escalates an open item that carries no stage at all", () => {
    const d = reconcile(item({ labels: ["factory"], labelEvents: [] }), [], NOW);
    expect(d.kind).toBe("escalate");
    if (d.kind !== "escalate") throw new Error("unreachable");
    expect(d.question).toContain("no stage label");
    expect(d.recommendation).toContain("Nothing can fire on this item");
  });

  it("escalates a stage whose branch has gone, rather than re-firing into a dead checkout", () => {
    const d = reconcile(
      item({
        labels: ["factory", "spec-derived"],
        branch: null,
        labelEvents: [{ name: "spec-derived", at: minutesAgo(600), action: "labeled" }],
      }),
      [],
      NOW,
    );
    expect(d.kind).toBe("escalate");
    if (d.kind !== "escalate") throw new Error("unreachable");
    expect(d.resumeStage).toBeNull();
  });

  it("escalates a stage label with no event explaining how it got there", () => {
    const d = reconcile(item({ labelEvents: [] }), [], NOW);
    expect(d.kind).toBe("escalate");
  });

  // Every escalation has to survive decision-section.sh, which refuses empty
  // fields and an unknown stage. An escalation that cannot be composed is an
  // item that stops silently — the exact failure this layer exists to prevent.
  it("always produces fields the decision-section composer will accept", () => {
    const escalating: ObservedItem[] = [
      item({ labels: ["factory"], labelEvents: [] }),
      item({ labels: ["factory", "spec-derived"], branch: null, labelEvents: [{ name: "spec-derived", at: minutesAgo(600), action: "labeled" }] }),
      item({ labelEvents: [{ name: "verify", at: minutesAgo(600), action: "labeled" }], refires: [{ key: refireKey("verify", SHA), count: MAX_AUTO_REFIRES, lastAt: NOW }] }),
      item({ labelEvents: [] }),
    ];
    for (const subject of escalating) {
      const d = reconcile(subject, [], NOW);
      expect(d.kind).toBe("escalate");
      if (d.kind !== "escalate") throw new Error("unreachable");
      expect(d.question.trim().length).toBeGreaterThan(0);
      expect(d.options.trim().length).toBeGreaterThan(0);
      expect(d.recommendation.trim().length).toBeGreaterThan(0);
      expect(d.resumeStage === null || (["needs-spec", "spec-derived", "verify", "qa-changes"] as string[]).includes(d.resumeStage)).toBe(true);
    }
  });
});

describe("stage age comes from the timeline, not from updatedAt", () => {
  it("uses the most recent application of the label", () => {
    const subject = item({
      labelEvents: [
        { name: "verify", at: minutesAgo(600), action: "labeled" },
        { name: "verify", at: minutesAgo(1), action: "unlabeled" },
        { name: "verify", at: minutesAgo(1), action: "labeled" },
      ],
    });
    expect(stageEnteredAt(subject, "verify")).toBe(minutesAgo(1));
    expect(reconcile(subject, [], NOW).kind).toBe("holding");
  });
});

describe("reading a QA verdict back", () => {
  it("reads the stamped verdict and SHA", () => {
    const v = latestQaVerdict([
      { body: `**QA passed**\n\nfine\n\n<!-- qa-verdict verdict=PASS sha=${SHA} -->`, created_at: NOW },
    ]);
    expect(v).toMatchObject({ verdict: "PASS", sha: SHA });
  });

  it("reads an unstamped legacy verdict with a null SHA", () => {
    const v = latestQaVerdict([{ body: "**QA findings** (cycle 1 of 3)\n\nthings", created_at: NOW }]);
    expect(v).toMatchObject({ verdict: "CHANGES", sha: null });
  });

  it("takes the latest verdict when several exist", () => {
    const v = latestQaVerdict([
      { body: `**QA findings**\n\n<!-- qa-verdict verdict=CHANGES sha=${OTHER_SHA} -->`, created_at: minutesAgo(60) },
      { body: `**QA passed**\n\n<!-- qa-verdict verdict=PASS sha=${SHA} -->`, created_at: NOW },
    ]);
    expect(v).toMatchObject({ verdict: "PASS", sha: SHA });
  });

  it("returns null when no comment carries a verdict", () => {
    expect(latestQaVerdict([{ body: "just chatting", created_at: NOW }])).toBeNull();
  });
});

describe("the durable state record", () => {
  it("round-trips a ledger", () => {
    const encoded = `### Factory state\n\n<!-- factory-reconciler-state\n${JSON.stringify({ version: 1, refires: [{ key: "verify@abc", count: 2, lastAt: NOW }] })}\n-->`;
    expect(parseState(encoded).refires).toEqual([{ key: "verify@abc", count: 2, lastAt: NOW }]);
  });

  it("treats an unparseable or absent record as empty rather than throwing", () => {
    expect(parseState("no marker here").refires).toEqual([]);
    expect(parseState("<!-- factory-reconciler-state {not json} -->").refires).toEqual([]);
    expect(parseState("<!-- factory-reconciler-state {\"version\":99} -->").refires).toEqual([]);
  });
});

// #148 is the worked example: it has carried `needs-spec` since 12 August while
// its branch carries a spec, acceptance tests AND an implementation. Re-firing
// the PM there is not a no-op — the PM cuts the branch fresh — so the stage a
// label claims has to be checked against what the stage was supposed to produce.
describe("a stage whose work is already on the branch", () => {
  const specOnly = { hasSpec: true, hasTests: true, hasImplementation: false };
  const complete = { hasSpec: true, hasTests: true, hasImplementation: true };
  const stale = (stage: Stage) => ({
    labels: ["factory", stage],
    labelEvents: [{ name: stage, at: minutesAgo(600), action: "labeled" as const }],
  });

  it("advances a needs-spec item whose PM demonstrably finished", () => {
    const d = reconcile(item({ ...stale("needs-spec"), branchContent: specOnly }), [], NOW);
    expect(d).toMatchObject({ kind: "correct-label", add: ["spec-derived"], remove: ["needs-spec"] });
  });

  it("advances straight to verify when the implementation is there and the gate is green", () => {
    const d = reconcile(
      item({ ...stale("needs-spec"), branchContent: complete, ci: greenCi() }),
      [],
      NOW,
    );
    expect(d).toMatchObject({ kind: "correct-label", add: ["verify"], remove: ["needs-spec"] });
  });

  it("refuses to guess when the implementation is there but the gate is not green", () => {
    const d = reconcile(item({ ...stale("needs-spec"), branchContent: complete }), [], NOW);
    expect(d.kind).toBe("escalate");
    if (d.kind !== "escalate") throw new Error("unreachable");
    expect(d.question).toContain("which stage is it really in");
    expect(d.recommendation).toContain("its age says nothing");
  });

  it("never re-fires the PM over a branch that already exists", () => {
    const d = reconcile(
      item({ ...stale("needs-spec"), branchContent: { hasSpec: false, hasTests: false, hasImplementation: true } }),
      [],
      NOW,
    );
    expect(d.kind).toBe("escalate");
    if (d.kind !== "escalate") throw new Error("unreachable");
    expect(d.recommendation).toContain("divergent push");
  });

  it("hands over to QA when the Engineer's own advance condition is met", () => {
    const d = reconcile(
      item({ ...stale("spec-derived"), branchContent: complete, ci: greenCi() }),
      [],
      NOW,
    );
    expect(d).toMatchObject({ kind: "correct-label", add: ["verify"], remove: ["spec-derived"] });
  });

  it("re-fires the Engineer rather than advancing when the gate is red", () => {
    const d = reconcile(
      item({
        ...stale("spec-derived"),
        branchContent: complete,
        ci: { sha: SHA, status: "completed", conclusion: "failure", url: "https://example.invalid/ci" },
      }),
      [],
      NOW,
    );
    expect(d.kind).toBe("refire");
  });

  it("does not advance on a green gate belonging to an older commit", () => {
    const d = reconcile(
      item({ ...stale("spec-derived"), branchContent: complete, ci: greenCi(OTHER_SHA) }),
      [],
      NOW,
    );
    expect(d.kind).toBe("refire");
  });

  it("leaves all of this alone until the stall threshold is reached", () => {
    const d = reconcile(
      item({
        labels: ["factory", "needs-spec"],
        labelEvents: [{ name: "needs-spec", at: minutesAgo(5), action: "labeled" }],
        branchContent: specOnly,
      }),
      [],
      NOW,
    );
    expect(d.kind).toBe("holding");
  });
});

// The twice-repeated blind spot in this repo is testing that step logic
// composes correctly while the artefact it calls does not exist on the branch
// that runs it. These assert the plumbing, not the logic.
describe("the runtime plumbing exists and matches the logic", () => {
  const wf = (name: string): string => readFileSync(`.github/workflows/${name}`, "utf8");

  it("the reconciler workflow runs the script this module lives in", () => {
    expect(wf("factory-reconciler.yml")).toContain("npx tsx scripts/factory/reconcile.ts");
    expect(() => readFileSync("scripts/factory/reconcile.ts", "utf8")).not.toThrow();
  });

  it("tsx is a pinned dependency rather than an unpinned network fetch", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    expect(pkg.devDependencies?.tsx).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("every stage the logic can re-fire names a workflow that accepts a dispatch", () => {
    for (const [stage, file] of Object.entries(STAGE_WORKFLOW)) {
      const text = wf(file);
      expect(text, `${file} must accept workflow_dispatch`).toContain("workflow_dispatch:");
      // The stage the reconciler passes must be one the workflow offers, or the
      // dispatch is rejected at the API and the re-fire silently does nothing.
      expect(text, `${file} must offer the '${stage}' stage`).toMatch(
        new RegExp(`^\\s+- ${stage}$`, "m"),
      );
      expect(text, `${file} must read the dispatched issue`).toContain(
        "github.event.issue.number || inputs.issue",
      );
    }
  });

  it("every stage workflow stamps the issue number into its run name", () => {
    for (const file of new Set(Object.values(STAGE_WORKFLOW))) {
      const text = wf(file);
      const runName = /^run-name:.*$/m.exec(text);
      expect(runName, `${file} must set run-name`).not.toBeNull();
      // The token the reconciler matches on, spelled exactly as it builds it.
      expect(runName?.[0]).toContain(runToken(0).replace("0]", ""));
      expect(runName?.[0]).toContain("github.event.issue.number || inputs.issue");
    }
  });

  it("no stage workflow still gates on a bare label name, which a dispatch cannot satisfy", () => {
    for (const file of new Set(Object.values(STAGE_WORKFLOW))) {
      const text = wf(file);
      const bare = text
        .split("\n")
        .filter((l) => /github\.event\.label\.name/.test(l))
        .filter((l) => !/inputs\.stage/.test(l));
      expect(bare, `${file} has label references a dispatch cannot satisfy: ${bare.join(" | ")}`).toEqual([]);
    }
  });

  it("concurrency keys on the resolved issue, so dispatches do not collapse into one group", () => {
    for (const file of new Set(Object.values(STAGE_WORKFLOW))) {
      const text = wf(file);
      const group = /^\s+group: factory-.*$/m.exec(text)?.[0] ?? "";
      expect(group, `${file} concurrency group`).toContain("github.event.issue.number || inputs.issue");
    }
  });

  it("QA stamps the SHA it reviewed, which every verdict-based correction is gated on", () => {
    expect(wf("factory-qa.yml")).toContain("qa-verdict verdict=%s sha=%s");
  });

  it("the digest collects what the reconciler escalates", () => {
    expect(wf("factory-decisions-digest.yml")).toContain("--label reconciler-escalated");
  });

  it("the threshold and the cap are constants, not literals at a call site", () => {
    const core = readFileSync("scripts/factory/reconcile-core.ts", "utf8");
    expect(core).toMatch(/export const STALL_THRESHOLD_MINUTES = \d+;/);
    expect(core).toMatch(/export const MAX_AUTO_REFIRES = \d+;/);
    expect(STALL_THRESHOLD_MINUTES).toBe(45);
    expect(MAX_AUTO_REFIRES).toBe(2);
  });
});
