import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMPTY_SOW_STATE,
  REQUIRED_CHECKLIST_QUESTIONS,
  getUnansweredRequiredChecklistQuestions,
  type SowState,
} from "@/lib/schemas/sow";

/**
 * `wrap_incomplete: false` has to mean the call captured the required slots.
 *
 * It didn't. The client accumulated the flag in whichever branch remembered —
 * the channel-already-gone path and the detour timeout — and both computed it
 * from the set FILTERED by askedRequiredSlotsRef. So a slot that was asked and
 * never answered dropped out of the flag as well as out of the detour, and the
 * call reported a clean wrap having captured nothing.
 *
 * Production, since the flag shipped on 1 Sep: seven calls, of which THREE
 * ended `wrap_incomplete: false` with `unasked_required: []` while missing three
 * or four required slots each — 30faef2a (3 Sep) and 0662f78c (1 Sep) both
 * without a crew answer and without materials. `declined_slots` is empty on all
 * 24 SoWs in the table, so not one of those was a refusal.
 *
 * Asked-once still governs whether the detour ASKS again. It never governed
 * whether we KNOW, and the fix is to stop letting it: finishConversation derives
 * the flag from the final SoW state, at the one point every ending funnels
 * through.
 */

const sow = (over: Partial<SowState>): SowState => ({ ...EMPTY_SOW_STATE, ...over });

/** A SoW with every required slot answered. */
const complete = (): SowState =>
  sow({
    labour_plan: {
      crew_description: "me and Liam",
      duration_days: 4,
      working_dates: "Monday and Tuesday",
      people_count: 2,
    },
    pricing: { mode: "days", fixed_amount: null },
    materials_supply: {
      responsibility: "contractor",
      contractor_supplied: ["Plaster"],
      customer_supplied: [],
    },
    agreed_costs: { day_rate: null, fixed_price: null, deposit_amount: null, notes: undefined, nothing_agreed: true },
  });

describe("what the required set actually is", () => {
  it("is five slots, not the three the client's comment named for months", () => {
    expect(REQUIRED_CHECKLIST_QUESTIONS).toEqual([
      "crew",
      "duration",
      "materials_supply",
      "working_dates",
      "agreed_costs",
    ]);
  });

  it("reports nothing outstanding when they are all answered", () => {
    expect(getUnansweredRequiredChecklistQuestions(complete())).toEqual([]);
  });
});

describe("job 30faef2a's shape — crew and materials never captured", () => {
  const asProduction = (): SowState => {
    const state = complete();
    return sow({
      ...state,
      labour_plan: { ...state.labour_plan!, crew_description: undefined },
      materials_supply: null,
      agreed_costs: null,
    });
  };

  it("is three required slots short", () => {
    expect(getUnansweredRequiredChecklistQuestions(asProduction())).toEqual([
      "crew",
      "materials_supply",
      "agreed_costs",
    ]);
  });

  it("stays short however many of them were ASKED", () => {
    // The whole defect in one assertion. The old flag was the unanswered set
    // minus the asked set, so asking all three and landing none of them
    // produced an empty flag — a clean wrap over a call that captured nothing.
    // Nothing in this function takes an asked-set, and that is the point.
    const outstanding = getUnansweredRequiredChecklistQuestions(asProduction());
    expect(outstanding.length).toBeGreaterThan(0);
  });
});

describe("a decline is not a gap", () => {
  it("drops a slot the contractor explicitly refused", () => {
    // D14. A refusal is an answer, so it must not raise the flag — otherwise
    // the fix above would flag every call where someone said "leave it".
    const state = complete();
    const refused = sow({
      ...state,
      agreed_costs: null,
      declined_slots: ["agreed_costs"],
    });
    expect(getUnansweredRequiredChecklistQuestions(refused)).toEqual([]);
  });

  it("but an empty declined_slots does not excuse an absent answer", () => {
    // Which is the production case: declined_slots is empty on all 24 SoWs.
    const state = complete();
    expect(
      getUnansweredRequiredChecklistQuestions(sow({ ...state, agreed_costs: null })),
    ).toEqual(["agreed_costs"]);
  });
});

/**
 * The client has to WIRE it that way. The set function being right is no use if
 * the flag is still assembled from the filtered set in three separate branches.
 *
 * Source-read for the reason tests/regression/the-reconciler-offers-a-way-out.test.ts
 * is: this lives in a 1,200-line client component behind a WebRTC data channel
 * and a realtime session, and what needs pinning is where the assignment lives.
 * The behaviour either side of it is covered above.
 */
describe("the client derives it in one place", () => {
  const source = readFileSync(
    resolve(__dirname, "../../src/components/voice/job-intake.tsx"),
    "utf8",
  );

  it("assigns the flag exactly once", () => {
    // Two branches used to own a copy; the ones that didn't were the leak.
    const assignments = source.match(
      /wrapIncompleteSlotsRef\.current\s*=\s*getUnansweredRequiredChecklistQuestions/g,
    );
    expect(assignments).toHaveLength(1);
  });

  it("derives it in finishConversation, which every ending funnels through", () => {
    const finish = source.slice(source.indexOf("const finishConversation"));
    const body = finish.slice(0, finish.indexOf("await draftQuote()"));
    expect(body).toContain("wrapIncompleteSlotsRef.current = getUnansweredRequiredChecklist");
  });

  it("never subtracts the asked set from the flag", () => {
    // The regression itself. askedRequiredSlotsRef may filter what we ASK; if
    // it ever filters what we RECORD, the flag starts lying again.
    //
    // Comments stripped first: this file explains the defect by name in the
    // prose right above the fix, and matching that would fail on the correct
    // implementation — which is the over-matching AGENTS.md warns about.
    const finish = source.slice(source.indexOf("const finishConversation"));
    const body = finish
      .slice(0, finish.indexOf("await draftQuote()"))
      .replace(/\/\/[^\n]*/g, "");
    expect(body).not.toContain("askedRequiredSlotsRef");
  });

  it("marks a slot asked only after the ask has actually gone out", () => {
    const detour = source.slice(source.indexOf("const concludeOrAskRequired"));
    const body = detour.slice(0, detour.indexOf("const armWrapDetourTimeout"));
    const sent = body.indexOf("sendResponse(dc, buildCombinedWrapInstruction");
    const marked = body.indexOf("askedRequiredSlotsRef.current.push");
    expect(sent).toBeGreaterThan(-1);
    expect(marked).toBeGreaterThan(sent);
  });

  it("treats a channel that refused the send as an ask that never happened", () => {
    const detour = source.slice(source.indexOf("const concludeOrAskRequired"));
    const body = detour.slice(0, detour.indexOf("const armWrapDetourTimeout"));
    expect(body).toMatch(/const asked = sendResponse\(/);
    expect(body).toMatch(/if \(!asked\)/);
  });

  it("reports whether the response was sent, rather than swallowing it", () => {
    expect(source).toMatch(
      /const sendResponse = \([\s\S]{0,120}\): boolean => \{\s*if \(dc\.readyState !== "open"\) return false;/,
    );
  });
});
