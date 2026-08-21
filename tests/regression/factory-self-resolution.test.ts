import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #300 was declared ambiguous by three separate PM runs. The third listed four
 * options, recommended option (a), and blocked — twenty minutes after option
 * (a) had been decided and posted on the issue. It had the answer twice over.
 *
 * The protocol that replaces that is prose in AGENTS.md, so these bind the
 * parts a workflow has to carry for the prose to mean anything: that the PM is
 * pointed at the decision record before it may block, that a block has to
 * declare which of the three permitted reasons it is, and that an untyped
 * block is reported rather than silently accepted — or, worse, failed, which
 * would destroy the spec the escape exists to save.
 */

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

const AGENTS = read("AGENTS.md");
const RECORD = read("areas/motko.md");
const PM = read(".github/workflows/factory-pm.yml");

const BLOCK_TYPES = ["CAPABILITY FAULT", "CONTRACT CONFLICT", "ESCALATION"];

describe("the protocol is written down", () => {
  it("states that uncertainty is not a blocking reason", () => {
    expect(AGENTS).toMatch(/Uncertainty is\s*\n?\s*not a blocking reason/i);
  });

  it("names all three permitted block types", () => {
    for (const t of BLOCK_TYPES) expect(AGENTS, t).toContain(t);
  });

  it("keeps money, contractual copy and irreversible writes on the escalation list", () => {
    const list = AGENTS.slice(AGENTS.indexOf("Escalate to a human"));
    for (const item of [
      /\*\*Money\.\*\*/,
      /legal or contractual copy/i,
      /Irreversible writes/i,
      /Auth, permissions/i,
      /App Store/i,
    ]) {
      expect(list, String(item)).toMatch(item);
    }
  });

  it("points at the decision record by its real path", () => {
    expect(AGENTS).toContain("areas/motko.md");
  });
});

describe("the decision record", () => {
  it("documents the entry shape agents must append", () => {
    for (const field of ["Decision:", "Rationale:", "Ticket:", "Reversible:", "Precedent:"]) {
      expect(RECORD, field).toContain(field);
    }
  });

  it("says a recorded decision is binding rather than advisory", () => {
    expect(RECORD).toMatch(/binding/i);
    expect(RECORD, "conflicts get reported, not resolved").toContain("CONTRACT CONFLICT");
  });

  it("carries the seeded decisions, each pointing at what implements it", () => {
    for (const where of [
      "src/lib/contracts/build-variables.ts",
      "src/lib/contracts/templates.ts",
      "src/lib/job-history.ts",
      "apple-app-site-association",
    ]) {
      expect(RECORD, where).toContain(where);
    }
  });
});

describe("the PM runs the protocol before it may block", () => {
  it("is told to read the decision record first", () => {
    expect(PM).toContain("areas/motko.md");
    expect(PM).toMatch(/Uncertainty is not a reason to block/i);
  });

  it("requires the escape line to declare a type", () => {
    expect(PM).toContain("AMBIGUOUS: <TYPE>");
    for (const t of BLOCK_TYPES) expect(PM, t).toContain(t);
  });

  // The escape exists to SAVE the spec: without it the run fails and the spec
  // dies with the runner. Enforcing the new format by failing the run would
  // reintroduce exactly that loss, over the shape of a sentence.
  it("reports an untyped block instead of failing the run", () => {
    const branch = PM.slice(PM.indexOf("block_typed=false"));
    const near = branch.slice(0, 600);
    expect(near, "must warn").toContain("::warning::");
    expect(near, "must not fail the run").not.toContain("::error::");
    expect(PM).toContain('echo "outcome=ambiguous" >> "$GITHUB_OUTPUT"');
  });

  it("tells the human on the issue when a block arrived untyped", () => {
    expect(PM).toMatch(/This block carries no type/);
  });

  // A self-resolved judgement has to reach the branch, and the PM's own commit
  // is the only one permitted to touch the spec — so the record entry has to
  // be staged by the same `git add -A` that stages the spec.
  it("stages whatever the agent wrote, so a recorded decision is committed", () => {
    expect(PM).toContain("git add -A");
    expect(
      PM.indexOf("git add -A"),
      "staging must precede the commit that carries it",
    ).toBeLessThan(PM.indexOf("commit_if_staged"));
  });
});
