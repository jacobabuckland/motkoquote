/**
 * R2's two hard rules, and R3's default.
 *
 * "A retro finding must cite an outcome ID or it is discarded" (D9) and "every
 * finding cites ≥3 outcome IDs" (R2's AC) are enforced in code rather than
 * asked for in a prompt, and these tests are why that distinction is worth
 * making. The board's own recent history is three PM runs arguing fluently from
 * a false premise, and a retro is the single place where a confident wrong
 * conclusion turns into a permanent change to AGENTS.md or to production code.
 */

import { describe, expect, it } from "vitest";

import type { Outcome } from "../../scripts/supervisor/outcomes";
import {
  ROUTES,
  findingTitle,
  findings,
  haltVerdicts,
  patternKey,
  renderRetro,
  routeFor,
  unclassifiedCount,
} from "../../scripts/supervisor/retro";

function outcome(overrides: Partial<Outcome> = {}): Outcome {
  return {
    id: "revert:abc123def456",
    type: "revert",
    ticket: "481",
    pr: null,
    date: "2026-08-28T09:00:00.000Z",
    artefact: "abc123def456",
    detail: "Revert 'PRICE-4: reconciliation gate'",
    ...overrides,
  };
}

/** n outcomes that all group under the same pattern, with distinct ids. */
function group(n: number, detail: string): Outcome[] {
  return Array.from({ length: n }, (_, i) => outcome({ id: `revert:sha${i}`, detail }));
}

describe("findings require three instances", () => {
  it("produces no finding from two instances", () => {
    expect(findings(group(2, "typecheck failure in the acceptance test"))).toEqual([]);
  });

  it("produces a finding from three", () => {
    const found = findings(group(3, "typecheck failure in the acceptance test"));
    expect(found).toHaveLength(1);
    expect(found[0].citations).toHaveLength(3);
  });

  it("produces nothing at all from an empty dataset", () => {
    expect(findings([])).toEqual([]);
  });

  it("cites the outcome ids themselves, so a human can check each one", () => {
    const found = findings(group(3, "eslint failure"));
    expect(found[0].citations).toEqual(["revert:sha0", "revert:sha1", "revert:sha2"]);
  });
});

describe("every finding carries exactly one of the five routes", () => {
  it("routes each pattern to a listed route", () => {
    // Only details the classifier actually recognises. An unmatched one now
    // yields no pattern and therefore no finding, which is its own test above.
    const patterns = [
      "typecheck failure",
      "eslint failure",
      "acceptance test frozen",
      "migration and schema",
      "flaky runner timeout",
      "stub not implemented",
      "decision ambiguous",
    ];

    for (const detail of patterns) {
      const found = findings(group(3, detail));
      expect(found).toHaveLength(1);
      expect(ROUTES).toContain(found[0].route);
    }
  });

  it("puts the routing in the ticket title, per §R2", () => {
    const found = findings(group(3, "typecheck failure"));
    expect(findingTitle(found[0])).toBe("[retro] typecheck failures → CI check / lint");
  });
});

describe("the AGENTS.md route must justify itself", () => {
  it("states why the other four routes cannot express it", () => {
    // R2's AC. An AGENTS.md line is advice an agent may read and still not
    // follow — this repo has the receipts — so it is the last resort and has to
    // argue for itself.
    //
    // Exercised through routeFor directly rather than through findings(),
    // because every pattern the classifier can NAME now has a mechanical route.
    // This is the safety net for a pattern added later without one: it defaults
    // to the weakest lever and is forced to justify itself.
    const { route, whyNot } = routeFor("a pattern nobody has mapped to a route");
    expect(route).toBe("AGENTS.md line");
    expect(whyNot).toMatch(/lint|codemod|fixture|template/i);
  });

  it("does not attach that justification to a mechanical route", () => {
    const found = findings(group(3, "typecheck failure"));
    expect(found[0].why_not_other_routes).toBeUndefined();
  });

  it("prefers a mechanical route wherever one exists", () => {
    expect(routeFor("typecheck failures").route).toBe("CI check / lint");
    expect(routeFor("acceptance-test contracts").route).toBe("fixture test");
    expect(routeFor("specs blocking on ambiguity").route).toBe("ticket-template change");
  });
});

describe("unclassified outcomes are a pile, not a pattern", () => {
  // This would have filed a ticket on the first live retro. Fourteen unrelated
  // halts — a Stripe fee change, a spec dispute, a QA disagreement — grouped
  // under `halt (unclassified)`, cleared the three-instance bar on volume
  // alone, and routed to `AGENTS.md line` because that is the fallback. Every
  // Monday, for ever.
  //
  // It is the exact failure the >=3 bar exists to prevent, reached THROUGH the
  // bar rather than around it.
  const unmatched = (n: number): Outcome[] =>
    Array.from({ length: n }, (_, i) =>
      outcome({ id: `halt:${i}`, type: "halt", detail: `blocked on 'Something ${i}' — resolved after 2h` }),
    );

  it("files nothing from fourteen unrelated unclassified halts", () => {
    expect(findings(unmatched(14))).toEqual([]);
  });

  it("gives an unclassified outcome no pattern key at all", () => {
    expect(patternKey(outcome({ detail: "something the classifier has never seen" }))).toBeNull();
  });

  it("still groups outcomes that DO match a pattern", () => {
    // The fix must not stop real findings. Three typecheck failures alongside
    // fourteen unclassified halts still produce exactly one finding.
    const mixed = [...unmatched(14), ...group(3, "typecheck failure in the acceptance test")];
    const found = findings(mixed);
    expect(found).toHaveLength(1);
    expect(found[0].pattern).toBe("typecheck failures");
  });

  it("reports the unclassified count so a gap in the classifier is visible", () => {
    // Not filed, but not hidden either: a number that stays high means the
    // classifier needs a new rule.
    expect(unclassifiedCount(unmatched(14))).toBe(14);
    const out = renderRetro([], [], "2026-08-31", 14);
    expect(out).toContain("14 outcomes did not match any pattern");
    expect(out).toContain("a pile, not a pattern");
  });

  it("says nothing about unclassified outcomes when there are none", () => {
    expect(renderRetro([], [], "2026-08-31", 0)).not.toContain("did not match any pattern");
  });
});

describe("pattern grouping", () => {
  it("puts three spellings of the same problem in one group", () => {
    // A key derived from free text would split three instances of one problem
    // into three patterns of one, and the ≥3 rule would then never fire.
    expect(patternKey(outcome({ detail: "tsc failed with TS2554" }))).toBe(
      patternKey(outcome({ detail: "typecheck error in tests/" })),
    );
  });

  it("keeps genuinely different problems apart", () => {
    expect(patternKey(outcome({ detail: "migration not applied" }))).toBe("schema and migrations");
    expect(patternKey(outcome({ detail: "flaky runner timeout" }))).toBe("CI flakiness");
  });
});

describe("R3 — halt review", () => {
  const halt = (detail: string): Outcome =>
    outcome({ id: "halt:481:blocked:t", type: "halt", detail });

  it("gives every closed halt a verdict", () => {
    const verdicts = haltVerdicts([
      halt("blocked on 'Fee visibility' — resolved after 27h"),
      halt("blocked on 'Other' — resolved after 3h"),
    ]);
    expect(verdicts).toHaveLength(2);
    for (const v of verdicts) expect(v.verdict).toMatch(/^(necessary|rule-missing: )/);
  });

  it("ignores halts that are still open", () => {
    expect(haltVerdicts([halt("blocked on 'Fee visibility' — still open")])).toEqual([]);
  });

  it("proposes a rule only when the halt itself says the answer was recorded", () => {
    const derivable = haltVerdicts([halt("blocked — this was already decided, resolved after 2h")]);
    expect(derivable[0].verdict).toMatch(/^rule-missing: /);
  });

  it("defaults to `necessary`, which is the conservative verdict", () => {
    // Calling a halt unnecessary when it was not teaches the scoping agent to
    // push through a question it should have asked. The fee-visibility question
    // that surfaced as an incident on 20 August is what that costs.
    const verdicts = haltVerdicts([halt("blocked on 'Should the fee be visible?' — resolved after 27h")]);
    expect(verdicts[0].verdict).toBe("necessary");
  });
});

describe("rendering", () => {
  it("says plainly that nothing met the bar, rather than padding", () => {
    const out = renderRetro([], [], "2026-08-31");
    expect(out).toMatch(/No pattern reached three instances/);
    expect(out).toContain("No halts closed this week.");
  });

  it("shows each finding's citations and its route", () => {
    const out = renderRetro(findings(group(3, "typecheck failure")), [], "2026-08-31");
    expect(out).toContain("→ CI check / lint");
    expect(out).toMatch(/Cited outcomes \(3\)/);
  });
});
