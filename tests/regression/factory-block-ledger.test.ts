import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  categorise,
  neededHumanFor,
  parseRecords,
  refineOnResolution,
  renderRecord,
  renderWeeklyLine,
  summarise,
  type BlockRecord,
  type CategoryEvidence,
} from "@/../scripts/factory/block-ledger";
import { readEvidence } from "@/../scripts/factory/record-block";

const evidence = (over: Partial<CategoryEvidence> = {}): CategoryEvidence => ({
  label: "blocked",
  comment: "",
  frozenAttributed: [],
  failingSources: [],
  failingStep: null,
  ...over,
});

const record = (over: Partial<BlockRecord> = {}): BlockRecord => ({
  kind: "block",
  issue: 239,
  label: "blocked",
  at: "2026-08-18T10:00:00Z",
  sha: "a".repeat(40),
  stage: "verify",
  failingStep: null,
  category: "unknown",
  neededHuman: null,
  minutesBlocked: null,
  ...over,
});

describe("categorising a block from its evidence", () => {
  it("reads a spec dispute from the label or from the marker", () => {
    expect(categorise(evidence({ label: "spec-dispute" }))).toBe("spec-error");
    expect(categorise(evidence({ comment: "SPEC ERROR: the query contradicts edge case 4" }))).toBe(
      "spec-error",
    );
  });

  it("calls a frozen file attributed as failing contract decay", () => {
    expect(
      categorise(
        evidence({
          frozenAttributed: ["tests/acceptance/171.test.ts"],
          failingSources: ["tests/acceptance/171.test.ts"],
        }),
      ),
    ).toBe("contract-decay");
  });

  it("calls a failure the Engineer can reach an implementation problem", () => {
    expect(categorise(evidence({ failingSources: ["src/lib/fees.ts"] }))).toBe("implementation");
  });

  it("calls a run that died before judging anything infrastructure", () => {
    for (const step of ["Run actions/checkout@v4", "npm ci", "Materialise the composer"]) {
      expect(categorise(evidence({ failingStep: step })), step).toBe("infrastructure");
    }
  });

  // The instruction that matters most: never guess a category to avoid an
  // unknown. A run of unknowns is a finding about diagnosability.
  it("says unknown when the evidence does not determine a cause", () => {
    expect(categorise(evidence({ comment: "something went wrong" }))).toBe("unknown");
    expect(categorise(evidence({ comment: "The failure could not be attributed to a file." }))).toBe(
      "unknown",
    );
  });

  it("never invents factory-defect at block time, which is not knowable then", () => {
    const everyShape: CategoryEvidence[] = [
      evidence(),
      evidence({ failingSources: ["src/x.ts"] }),
      evidence({ frozenAttributed: ["tests/acceptance/1.test.ts"], failingSources: ["tests/acceptance/1.test.ts"] }),
      evidence({ failingStep: "npm ci" }),
      evidence({ label: "spec-dispute" }),
    ];
    for (const e of everyShape) expect(categorise(e)).not.toBe("factory-defect");
  });
});

describe("what the resolution reveals", () => {
  // The only reliable signal for a misfiring guard, and it only exists in
  // hindsight: the branch did not change and the item stopped being blocked, so
  // the block was not about the work.
  it("calls an unchanged branch a factory defect", () => {
    expect(refineOnResolution("implementation", "abc", "abc")).toBe("factory-defect");
    expect(refineOnResolution("unknown", "abc", "abc")).toBe("factory-defect");
    expect(refineOnResolution("contract-decay", "abc", "abc")).toBe("factory-defect");
  });

  it("leaves the category alone when the branch moved", () => {
    expect(refineOnResolution("implementation", "abc", "def")).toBe("implementation");
  });

  it("never overrides a spec error, whose fix amends the branch anyway", () => {
    expect(refineOnResolution("spec-error", "abc", "abc")).toBe("spec-error");
  });

  it("does not refine when either SHA is unknown", () => {
    expect(refineOnResolution("implementation", null, "abc")).toBe("implementation");
    expect(refineOnResolution("implementation", "abc", null)).toBe("implementation");
  });

  it("treats a stopped label coming off as a person answering, except the reconciler's own", () => {
    expect(neededHumanFor("blocked", false)).toBe(true);
    expect(neededHumanFor("spec-dispute", false)).toBe(true);
    expect(neededHumanFor("reconciler-escalated", true)).toBe(false);
    expect(neededHumanFor("reconciler-escalated", false)).toBe(true);
  });
});

describe("records survive a round trip", () => {
  it("renders and parses back", () => {
    const original = record({ category: "contract-decay", failingStep: "Test" });
    expect(parseRecords([renderRecord(original)])).toEqual([original]);
  });

  it("renders something a person can read, not only the JSON", () => {
    const out = renderRecord(record({ category: "contract-decay" }));
    expect(out).toContain("**Blocked** — #239");
    expect(out).toContain("a frozen file was invalidated");
  });

  it("describes a resolution with its duration and who cleared it", () => {
    const out = renderRecord(
      record({ kind: "resolution", minutesBlocked: 90, neededHuman: true, category: "factory-defect" }),
    );
    expect(out).toContain("was `blocked` for 90 min");
    expect(out).toContain("cleared human");
  });

  // Losing one row is survivable; losing the digest that reports the rest is not.
  it("drops a malformed record rather than throwing", () => {
    expect(parseRecords(["<!-- factory-block-record {nope} -->"])).toEqual([]);
    expect(parseRecords(["no marker at all"])).toEqual([]);
  });

  it("ignores an unrelated comment on the same issue", () => {
    expect(parseRecords(["## Decisions pending — Tuesday", renderRecord(record())])).toHaveLength(1);
  });
});

describe("the weekly summary", () => {
  const now = "2026-08-18T12:00:00Z";
  const ago = (hours: number): string =>
    new Date(Date.parse(now) - hours * 3600_000).toISOString();

  it("counts blocks, resolutions and how many took a person", () => {
    const s = summarise(
      [
        record({ at: ago(10) }),
        record({ issue: 240, at: ago(9) }),
        record({ kind: "resolution", at: ago(8), neededHuman: true, minutesBlocked: 120, category: "factory-defect" }),
      ],
      now,
    );
    expect(s.blocked).toBe(2);
    expect(s.resolved).toBe(1);
    expect(s.neededHuman).toBe(1);
  });

  it("ignores anything older than the window", () => {
    expect(summarise([record({ at: ago(24 * 30) })], now).blocked).toBe(0);
  });

  // The resolution had more evidence than the block did, so it wins.
  it("categorises a resolved item by its resolution", () => {
    const s = summarise(
      [
        record({ at: ago(5), category: "implementation" }),
        record({ kind: "resolution", at: ago(4), category: "factory-defect", minutesBlocked: 60 }),
      ],
      now,
    );
    expect(s.byCategory).toEqual({ "factory-defect": 1 });
  });

  it("counts a still-open block under what was known at the time", () => {
    expect(summarise([record({ at: ago(3), category: "contract-decay" })], now).byCategory).toEqual({
      "contract-decay": 1,
    });
  });

  it("reports a median time blocked", () => {
    const s = summarise(
      [
        record({ kind: "resolution", at: ago(3), minutesBlocked: 10 }),
        record({ issue: 2, kind: "resolution", at: ago(2), minutesBlocked: 30 }),
        record({ issue: 3, kind: "resolution", at: ago(1), minutesBlocked: 50 }),
      ],
      now,
    );
    expect(s.medianMinutes).toBe(30);
  });

  // An empty ledger and a quiet factory look identical, and only one is good
  // news. The digest must not present the first as the second.
  it("does not read an empty ledger as an all-clear", () => {
    const out = renderWeeklyLine(summarise([], now));
    expect(out).toContain("No blocks recorded");
    expect(out).toContain("an empty ledger and a quiet factory look identical");
  });

  it("names every category it counts, and says the counts are heuristic", () => {
    const out = renderWeeklyLine(
      summarise([record({ at: ago(2), category: "contract-decay" })], now),
    );
    expect(out).toContain("contract-decay");
    expect(out).toContain("a frozen file was invalidated");
    expect(out).toContain("`unknown` means the evidence did not determine a cause");
  });

  it("has a stated meaning for every category it can emit", () => {
    for (const c of CATEGORIES) {
      const out = renderWeeklyLine(summarise([record({ at: ago(1), category: c })], now));
      expect(out, c).toContain(`\`${c}\``);
      expect(out, `${c} must not render as unrecognised`).not.toContain("unrecognised category");
    }
  });
});

describe("reading the evidence out of a blocking comment", () => {
  it("takes the frozen files the report attributed, not any mention", () => {
    const comment = [
      "**CI is red on `abc`.**",
      "The failing log names files the Engineer may not edit:",
      "",
      "```",
      "tests/acceptance/171.test.ts",
      "```",
    ].join("\n");
    const e = readEvidence(comment);
    expect(e.frozenAttributed).toEqual(["tests/acceptance/171.test.ts"]);
  });

  it("takes the attributed sources when nothing frozen failed", () => {
    const comment = [
      "The failing log attributes the failure to:",
      "",
      "```",
      "tests/regression/live-checks.test.ts",
      "```",
    ].join("\n");
    expect(readEvidence(comment).failingSources).toEqual(["tests/regression/live-checks.test.ts"]);
  });

  it("reads the failing step", () => {
    expect(readEvidence("Engineer agent failed at step **Implement**. See the run log").failingStep).toBe(
      "Implement",
    );
  });

  it("finds nothing in a comment that attributes nothing", () => {
    const e = readEvidence("**The failure could not be attributed to a file.**");
    expect(e.failingSources).toEqual([]);
    expect(e.frozenAttributed).toEqual([]);
  });
});

describe("the runtime plumbing", () => {
  const ledger = readFileSync(".github/workflows/factory-block-ledger.yml", "utf8");
  const digest = readFileSync(".github/workflows/factory-decisions-digest.yml", "utf8");

  it("the recorder runs the script this module lives beside", () => {
    expect(ledger).toContain("npx tsx scripts/factory/record-block.ts");
  });

  it("fires on a stopped label going on AND coming off", () => {
    expect(ledger).toContain("types: [labeled, unlabeled]");
    for (const label of ["blocked", "qa-disputed", "spec-dispute", "reconciler-escalated"]) {
      expect(ledger, `must watch ${label}`).toContain(`'${label}'`);
    }
  });

  it("cannot stop the factory when it fails, because it is only bookkeeping", () => {
    expect(ledger).toContain("continue-on-error: true");
  });

  it("the digest renders the weekly line from the ledger", () => {
    expect(digest).toContain("npx tsx scripts/factory/summarise-blocks.ts");
    expect(digest).toContain("not an all-clear");
  });

  it("the digest installs what that call needs", () => {
    expect(digest).toContain("actions/setup-node");
    expect(digest).toContain("npm ci");
  });

  it("records land where a label cannot reach them", () => {
    const tracker = /TRACKER: "(\d+)"/.exec(digest)?.[1];
    expect(tracker).toBeDefined();
    expect(ledger).toContain(`TRACKER: "${tracker}"`);
  });
});
