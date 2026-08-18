import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STOPPED_LABELS, reconcile } from "@/../scripts/factory/reconcile-core";
import type { ObservedItem } from "@/../scripts/factory/reconcile-core";

const wf = (name: string): string => readFileSync(`.github/workflows/${name}`, "utf8");

const engineer = wf("factory-engineer.yml");
const digest = wf("factory-decisions-digest.yml");
const poller = wf("factory-poll-notion.yml");

describe("a spec dispute gets its own stopped state", () => {
  // "The spec is wrong" was right four times out of four, each with a
  // reproduction. Sharing a label with "QA misread my code" put the highest
  // signal output in the system into the same queue as runner noise.
  it("is a label of its own, not folded into qa-disputed", () => {
    expect(engineer).toContain("spec-dispute");
    expect(STOPPED_LABELS).toContain("spec-dispute");
    expect(STOPPED_LABELS).toContain("qa-disputed");
  });

  it("is applied on both of the Engineer's spec-error exits", () => {
    // The no-changes dispute path picks the label from SPEC_ERROR.
    expect(engineer).toContain('DISPUTE_LABEL=spec-dispute');
    expect(engineer).toContain('DISPUTE_LABEL=qa-disputed');
    // The work-pushed path applies it directly.
    expect(engineer).toContain('gh issue edit "$ISSUE" --add-label spec-dispute --remove-label "$LABEL"');
  });

  it("is cleared when an item is resumed, like every other stopped label", () => {
    const resume = readFileSync("scripts/factory/resume.sh", "utf8");
    const loop = /^for L in (.*); do$/m.exec(resume)?.[1] ?? "";
    for (const label of ["blocked", "qa-disputed", "spec-dispute", "reconciler-escalated"]) {
      expect(loop, `resume.sh must clear ${label}`).toContain(label);
    }
  });

  // A state that stops an item but does not count against the ceiling is how a
  // ceiling stops meaning anything.
  it("counts against the poller's stopped-item ceiling", () => {
    expect(poller).toContain("--label spec-dispute");
    expect(poller).toContain("--label reconciler-escalated");
  });

  it("is left alone by the reconciler, which does not re-fire stopped items", () => {
    const item: ObservedItem = {
      number: 1,
      title: "x",
      labels: ["factory", "spec-dispute"],
      branch: { name: "factory/1", sha: "a".repeat(40) },
      branchContent: { hasSpec: true, hasTests: true, hasImplementation: true },
      ci: null,
      pr: null,
      qa: null,
      labelEvents: [],
      refires: [],
    };
    expect(reconcile(item, [], "2026-08-18T12:00:00Z").kind).toBe("skip");
  });
});

describe("the digest leads with spec disputes", () => {
  it("collects them", () => {
    expect(digest).toContain("--label spec-dispute");
  });

  it("renders them before the general blocked section", () => {
    const specHeading = digest.indexOf("Spec disputes —");
    const blockedLine = digest.indexOf("item(s) blocked and waiting on you");
    expect(specHeading).toBeGreaterThan(-1);
    expect(blockedLine).toBeGreaterThan(-1);
    expect(specHeading).toBeLessThan(blockedLine);
  });

  // The point is that the evidence is IN the digest. The round trip to the
  // issue is what made the highest-signal item the most expensive to action.
  it("carries the Engineer's own evidence inline", () => {
    expect(digest).toContain('test("SPEC ERROR:")');
    expect(digest).toContain("/SPEC ERROR:/,$p");
    expect(digest).toContain("What the Engineer says is wrong with the spec");
  });

  it("says so rather than rendering blank when the evidence is missing", () => {
    expect(digest).toContain("without the Engineer's account");
    expect(digest).toContain("which is a factory fault");
  });

  it("shows the decision section for a spec dispute too", () => {
    const specBlock = digest.slice(digest.indexOf("Spec disputes —"), digest.indexOf('if [ "$COUNT" = "0" ]'));
    expect(specBlock).toContain("## DECISION NEEDED");
    expect(specBlock).toContain("Fixes outside my permissions");
  });

  // The existing careful qualification: never claim the factory is idle while
  // something is in fact waiting. Five items stayed invisible for three days
  // under a digest that reported all clear.
  it("never reports all clear while a spec dispute is open", () => {
    expect(digest).toContain('[ "$STALLED_COUNT" = "0" ] && [ "$SPEC_COUNT" = "0" ]');
    expect(digest).toContain("No further decisions pending beyond the spec disputes above");
  });

  it("does not also list a spec dispute as a stalled item", () => {
    const stalled = digest.slice(digest.indexOf("STALLED=$("), digest.indexOf("STALLED_COUNT="));
    expect(stalled).toContain('index("spec-dispute")');
  });
});

describe("shipping clears the labels an item passed through", () => {
  const ship = readFileSync(".github/workflows/factory-ship.yml", "utf8");

  // #221 merged still carrying `blocked`, and seven closed items read
  // "blocked, shipped" today. A finished item wearing the label that stopped it
  // is the same defect as everywhere else here — a label describing a state the
  // item left — and it makes shipped work look live on any board reading labels.
  it("removes every stage and stopped label, not just previewed", () => {
    for (const label of [
      "previewed",
      "blocked",
      "qa-disputed",
      "spec-dispute",
      "reconciler-escalated",
      "needs-spec",
      "spec-derived",
      "verify",
      "qa-changes",
    ]) {
      expect(ship, `ship must clear ${label}`).toContain(label);
    }
  });

  it("still adds shipped", () => {
    expect(ship).toContain("--add-label shipped");
  });
});
