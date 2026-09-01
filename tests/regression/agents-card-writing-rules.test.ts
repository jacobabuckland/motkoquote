import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Three dead acceptance contracts in two days, all from cards that described
// implementation artefacts instead of what a user should observe. The rules
// they produced live in AGENTS.md, and this guards them against being silently
// dropped — the file is long, and a rule nobody can find is a rule nobody
// follows.
//
// Asserted on MEANING, not on wording: each check matches the distinctive
// phrase its rule turns on, never a paragraph verbatim. Pinning whole prose
// would recreate the #351/#356 collision inside the document that warns about
// it, which would be a poor joke to ship.
//
// AGENTS.md is the deliverable here, not the implementation of one, so reading
// it is not the source-text assertion that check-acceptance-static.sh forbids —
// that rule is scoped to files under src/.

const agents = readFileSync("AGENTS.md", "utf8");

describe("never import one test file from another", () => {
  it("is stated", () => {
    expect(agents).toMatch(/never import one test file from another/i);
  });

  it("gives the reason, not just the prohibition", () => {
    // "Don't" without "because" is a rule that gets argued with.
    expect(agents).toMatch(/executes that suite inside this one/i);
  });

  it("cites the incident that produced it", () => {
    expect(agents).toContain("signup-referral-field.test");
  });
});

describe("state a requirement as behaviour, not as the test that covers it", () => {
  it("is stated", () => {
    expect(agents).toMatch(/never as "the test that covers it"/i);
  });

  it("gives both a checkable and an uncheckable example", () => {
    // The distinction is the whole rule; one example alone does not carry it.
    expect(agents).toMatch(/must still work/i);
    expect(agents).toMatch(/must still pass/i);
  });

  it("permits naming a file as context", () => {
    // A rule forbidding the mention would be unfollowable — cards legitimately
    // point at what covers something today.
    expect(agents).toMatch(/naming a file as context is fine/i);
  });
});

describe("out of scope means do not change it", () => {
  it("is stated", () => {
    expect(agents).toMatch(/never assert it is unchanged/i);
  });

  it("names the deadlock it prevents", () => {
    expect(agents).toMatch(/cannot both land at all/i);
  });

  it("distinguishes naming a file from naming a current value", () => {
    // The operative half for whoever writes the card.
    expect(agents).toMatch(/naming a \*\*current value\*\*/i);
  });
});

describe("the enforcement notes stay honest about what is mechanical", () => {
  it("records that the source-text rule is checked at PM time", () => {
    expect(agents).toContain("check-acceptance-static.sh");
  });

  it("records that the spec's Files section is read by a check", () => {
    // A new file omitted from ## Files now blocks its own acceptance test.
    // That coupling must not be discovered at block time.
    expect(agents).toContain("check-acceptance-run.sh");
    expect(agents).toMatch(/read by a check, not only by a human/i);
  });
});

// #476 froze an acceptance test whose fixture literal omitted four required
// fields of LineItem. It ran green — vitest ignores the missing fields — and
// only tsc objected, by which point the file was frozen and unrepairable.
//
// This lives in AGENTS.md rather than in a gate for a reason worth keeping
// written down: check-acceptance-types.sh reports TS2554 and nothing else,
// because tsc prints both types structurally in this diagnostic. The parameter
// type cannot be traced to the file declaring it, so the check has no way to
// tell "the item is about to change this type" — a correct failing-first test —
// from "the fixture is incomplete". Both produce the same message.
describe("the fixture-literal rule", () => {
  const agents = readFileSync("AGENTS.md", "utf8");

  it("tells the PM to write the whole shape", () => {
    expect(agents).toContain("A fixture literal must satisfy the real type");
  });

  it("names the diagnostic, which identifies none of the types involved", () => {
    expect(agents).toContain("is missing the following");
  });

  it("records why this is a rule and not a check", () => {
    // If someone later widens check-acceptance-types.sh to catch this, they
    // should meet the argument for why it was not widened before.
    expect(agents).toContain("both types structurally");
  });
});
