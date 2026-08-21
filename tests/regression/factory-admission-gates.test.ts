import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Three roadmap cards told the factory to stop, in plain English, and the
 * factory read none of them:
 *
 *   PAY-7  "Do not queue to the factory ... it needs a number in front of it,
 *           not an agent."                          -> queued, built, previewed
 *   LED-5  "Do NOT start until LED-1 through LED-3 are live"  -> admitted, built
 *   LED-4  "Before merge, Jacob confirms the wording with legal review"
 *
 * LED-4's VAT figure reached a human only because the PM happened to copy the
 * gate into the spec. Nothing enforced it, and green tests cannot tell you
 * which accounting assumption a number encodes.
 */

const load = async () =>
  await import("../../scripts/factory/admission-gates.mjs?t=" + Date.now());

// The real card text, not paraphrases — the wording is the thing being matched.
const PAY7 =
  "## Note\nDo not queue to the factory. This is a judgment call about how motko treats its own users when it has under-charged them, and it needs a number in front of it, not an agent.";
const LED4 =
  "## LEGAL / ACCURACY GATE\nThe VAT figure is the highest-risk element in this programme. Before merge, Jacob confirms the wording with legal review. Flat-rate scheme, cash vs accrual accounting, and CIS reverse charge all change what this number means.";
const ORDINARY =
  "## Fix\nAdd a reassurance strip to the payment page. Tested by a unit test.\n## Out of scope\nNo change to the fee.";

// LED-5's actual wording. It was admitted and built: the do-not-queue and
// pre-merge patterns did not cover "wait for something else first", and this
// file's own header named it as a known miss for weeks.
const LED5 =
  "## Note\nDo NOT start until LED-1 through LED-3 are live. The costs table it reads does not exist before then.";
const DEPENDS =
  "## Depends on\nBlocked by #306 — the disclosure primitive must merge before this can use it.";
const NOT_READY =
  "NOT FACTORY READY\nThis needs a number in front of it, not an agent.";

describe("reading a gate a card states in prose", () => {
  it("catches a card that says not to queue it", async () => {
    const { detectHumanGates } = await load();
    const gates = detectHumanGates(PAY7);
    expect(gates.map((g: { kind: string }) => g.kind)).toContain("do-not-queue");
  });

  it("catches a card that requires sign-off before merge", async () => {
    const { detectHumanGates } = await load();
    const gates = detectHumanGates(LED4);
    expect(gates.map((g: { kind: string }) => g.kind)).toContain("pre-merge-approval");
  });

  it("quotes the sentence that triggered it, so the record is checkable", async () => {
    const { detectHumanGates } = await load();
    expect(detectHumanGates(PAY7)[0].quote.toLowerCase()).toContain("do not queue");
  });

  // The failure mode that would get this switched off within a week: a gate
  // that fires on any card merely discussing VAT, legal wording or review.
  it("does not fire on an ordinary card", async () => {
    const { detectHumanGates } = await load();
    expect(detectHumanGates(ORDINARY)).toEqual([]);
  });

  it("does not fire on discussion of a topic, only on a directive", async () => {
    const { detectHumanGates } = await load();
    for (const body of [
      "The VAT treatment is standard-rate. Check with your accountant.",
      "This was reviewed by legal last quarter and the wording is settled.",
      "Merge order does not matter for this item.",
      "",
    ]) {
      expect(detectHumanGates(body), body.slice(0, 40)).toEqual([]);
    }
  });

  it("catches a card that says to wait for something else", async () => {
    const { detectHumanGates } = await load();
    for (const body of [LED5, DEPENDS]) {
      expect(detectHumanGates(body).map((g: { kind: string }) => g.kind), body.slice(0, 40)).toContain(
        "dependency",
      );
    }
  });

  it("catches the explicit not-factory-ready marker", async () => {
    const { detectHumanGates } = await load();
    expect(detectHumanGates(NOT_READY).map((g: { kind: string }) => g.kind)).toContain(
      "not-factory-ready",
    );
  });

  // The dependency matcher is the one most likely to over-fire, because cards
  // talk about what they follow all the time. It requires a directive AND an
  // explicit item reference for exactly this reason.
  it("does not read a card's own history as a dependency", async () => {
    const { detectHumanGates } = await load();
    for (const body of [
      "This clause was added after LED-2 shipped.",
      "This depends on how the customer reads it.",
      "Ordering follows the dashboard, which landed in PAY-4.",
      "The factory is ready for this once the copy is signed off by nobody in particular.",
    ]) {
      expect(detectHumanGates(body), body.slice(0, 40)).toEqual([]);
    }
  });

  it("survives a card with no body at all", async () => {
    const { detectHumanGates } = await load();
    expect(detectHumanGates(null)).toEqual([]);
    expect(detectHumanGates(undefined)).toEqual([]);
  });
});

describe("what admission does about it", () => {
  it("still admits an ordinary card, unstopped", async () => {
    const { admissionVerdict, detectHumanGates } = await load();
    const v = admissionVerdict(detectHumanGates(ORDINARY));
    expect(v.admit).toBe(true);
    expect(v.stopped).toBe(false);
  });

  // Never "refuse to create". An item that is never created is invisible, and
  // invisible is how PAY-7 stayed queued for a day.
  it("creates the item but stops it, rather than refusing it", async () => {
    const { admissionVerdict, detectHumanGates } = await load();
    for (const body of [PAY7, LED4]) {
      const v = admissionVerdict(detectHumanGates(body));
      expect(v.admit, "must still be created and visible").toBe(true);
      expect(v.stopped).toBe(true);
      expect(v.reason).toBeTruthy();
    }
  });

  it("reports the strongest gate when a card states more than one", async () => {
    const { admissionVerdict, detectHumanGates } = await load();
    const both = `${LED4}\n\n${PAY7}`;
    expect(admissionVerdict(detectHumanGates(both)).reason).toContain("not to queue");
  });

  it("ranks never-build above not-yet above approve-before-merge", async () => {
    const { admissionVerdict, detectHumanGates } = await load();
    expect(admissionVerdict(detectHumanGates(`${LED4}\n\n${LED5}`)).reason).toContain(
      "waits on something",
    );
    expect(admissionVerdict(detectHumanGates(`${LED5}\n\n${PAY7}`)).reason).toContain(
      "not to queue",
    );
    expect(admissionVerdict(detectHumanGates(`${LED5}\n\n${NOT_READY}`)).reason).toContain(
      "not factory ready",
    );
  });

  it("stops a dependency card without asking whether to wait", async () => {
    const { admissionVerdict, detectHumanGates, renderGateNotice } = await load();
    const gates = detectHumanGates(LED5);
    const v = admissionVerdict(gates);
    expect(v.admit, "must still be created and visible").toBe(true);
    expect(v.stopped).toBe(true);

    // Scheduling is not a decision. The notice must not read as a question,
    // and must not invite a placeholder built against an unlanded dependency.
    const notice = renderGateNotice(gates, v.reason);
    expect(notice).toMatch(/do not build a placeholder/i);
    expect(notice).toMatch(/do not ask whether to wait/i);
    expect(notice).toContain("needs-spec");
  });

  it("writes a notice quoting the card and saying how to release it", async () => {
    const { admissionVerdict, detectHumanGates, renderGateNotice } = await load();
    const gates = detectHumanGates(LED4);
    const notice = renderGateNotice(gates, admissionVerdict(gates).reason);
    expect(notice).toContain("Before merge");
    expect(notice, "must say nothing was built").toMatch(/no agent has run|nothing has been built/i);
    expect(notice, "must say how to release it").toContain("needs-spec");
  });
});

describe("the runtime plumbing", () => {
  const poller = readFileSync("scripts/factory/poll-notion.mjs", "utf8");

  it("the poller consults the gate", () => {
    expect(poller).toContain("detectHumanGates");
    expect(poller).toContain("admission-gates.mjs");
  });

  // The defect this test exists for: the first version applied `blocked` and
  // then fell through to the unconditional `needs-spec` write below, which
  // starts the pipeline. The guard was inert.
  it("a stopped item never reaches the stage-label write", () => {
    const block = /if \(verdict\.stopped\)[\s\S]*?\n    \}/.exec(poller)?.[0] ?? "";
    expect(block, "the stop branch must exist").not.toBe("");
    expect(block, "must leave the loop before the stage label is applied").toContain("continue");
    expect(block).not.toContain('"needs-spec"');

    // And the stage write must sit after the branch, not before it.
    expect(poller.indexOf("verdict.stopped")).toBeLessThan(poller.lastIndexOf('"needs-spec"'));
  });

  it("marks it Blocked in Notion, not In factory", () => {
    const block = /if \(verdict\.stopped\)[\s\S]*?\n    \}/.exec(poller)?.[0] ?? "";
    // Code only — the comment above the write explains the choice by naming
    // both statuses, and matching prose here would fail on the explanation.
    const code = block
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    expect(code).toContain('Status: { select: { name: "Blocked" } }');
    expect(code, "In factory would be a lie for an item no agent will touch").not.toContain(
      "In factory",
    );
  });

  it("does not consume a slot from the run cap", () => {
    const block = /if \(verdict\.stopped\)[\s\S]*?\n    \}/.exec(poller)?.[0] ?? "";
    expect(block).not.toContain("started +=");
  });
});
