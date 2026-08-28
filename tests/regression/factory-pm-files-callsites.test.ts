import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// #424 was blocked with a correct, complete implementation.
//
// It added a `statedPrices` parameter to `draftQuoteLineItems` and
// `compileDraftToLineItems`, and its spec's `## Files` section listed the three
// files whose bodies changed — omitting `src/app/jobs/actions.ts` and
// `src/lib/guest/quote.ts`, which had to pass the new argument through. QA
// found the code "correct and complete" and raised `spec-file-mismatch` on the
// list.
//
// The Engineer cannot fix that: `docs/specs/` is read-only to it, deliberately,
// so an implementation cannot make a spec-fidelity finding disappear by
// rewriting what it is judged against. The only routes out are amending the
// PM's first commit — a history rewrite nothing in this pipeline performs — or
// re-deriving the whole item.
//
// So the guidance below is load-bearing, and it is prose. This pins it.

const pm = readFileSync(".github/workflows/factory-pm.yml", "utf8");
const filesGuidance = (() => {
  const start = pm.indexOf("- Files: the complete list");
  const end = pm.indexOf("- Edge cases", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return pm.slice(start, end);
})();

describe("the PM is told what a complete Files section means", () => {
  it("says a signature change makes every call site a listed file", () => {
    expect(filesGuidance).toMatch(/call site/i);
    expect(filesGuidance).toMatch(/SIGNATURE/);
  });

  it("says why the Engineer cannot repair the omission downstream", () => {
    // Without this the instruction reads as tidiness rather than as the thing
    // that costs the item a cycle.
    expect(filesGuidance).toMatch(/read-only/i);
  });

  it("names spec-file-mismatch, the finding QA actually raises", () => {
    expect(filesGuidance).toContain("spec-file-mismatch");
  });

  it("closes the default-value loophole", () => {
    // `statedPrices = []` meant nothing broke without the call-site changes,
    // and nothing worked either. That is the reasoning that makes omitting them
    // feel safe, so it is answered directly.
    expect(filesGuidance).toMatch(/default value does not excuse it/i);
  });
});
