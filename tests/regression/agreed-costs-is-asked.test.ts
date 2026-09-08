/**
 * The money question gets asked.
 *
 * `agreed_costs` — "Has anything already been agreed with the customer on cost
 * — a day rate, a fixed price, or a deposit?" — sat in CHECKLIST_QUESTIONS and
 * not in REQUIRED_CHECKLIST_QUESTIONS, so the wrap dropped it. Production
 * bears that out: it is null on 13 of the 14 completed SoWs, and
 * `declined_slots` is empty on every recent one — so it was never asked, not
 * refused.
 *
 * The consequence is not only a missing field. `agreedPriceDisagrees` is the
 * send-time guard that catches the two independently-stored figures for one
 * job disagreeing — it exists because quote 45E0DB69 went out reading "at a
 * fixed price of £5,000" above a single priced line of £5.00. It returns false
 * when EITHER figure is absent, so with `agreed_costs` unasked on 13 of 14
 * jobs that guard was dead on almost all of them. Asking the question is what
 * gives it something to compare.
 *
 * The promotion is safe because of how "answered" is defined here: the slot is
 * satisfied by the OBJECT being present, not by any figure being set, and the
 * update_sow tool already says to "set this even if nothing was agreed (all
 * fields empty), so it's clear you asked". A job where nothing was agreed
 * answers it in one breath, and a contractor who deflects lands in
 * `declined_slots`, which the checklist already filters. Neither can trap a
 * wrap.
 */

import { describe, expect, it } from "vitest";

import { agreedPriceDisagrees } from "@/lib/quote-send-guards";
import {
  EMPTY_SOW_STATE,
  REQUIRED_CHECKLIST_QUESTIONS,
  getUnansweredChecklistQuestions,
  getUnansweredRequiredChecklistQuestions,
  type SowState,
} from "@/lib/schemas/sow";

const sow = (overrides: Partial<SowState>): SowState => ({ ...EMPTY_SOW_STATE, ...overrides });

describe("the agreed-costs slot must be asked before a clean wrap", () => {
  it("is a required checklist question", () => {
    expect(REQUIRED_CHECKLIST_QUESTIONS).toContain("agreed_costs");
  });

  it("is outstanding on a call that has answered everything else", () => {
    const state = sow({
      labour_plan: {
        people_count: 1,
        duration_days: 3,
        crew_description: "just me",
        working_dates: "week of the 15th",
      },
      pricing: { mode: "days", fixed_amount: null },
      materials_supply: { contractor_supplied: [], customer_supplied: [] },
    });

    expect(getUnansweredRequiredChecklistQuestions(state)).toEqual(["agreed_costs"]);
  });

  it("leaves the deadline a nice-to-have, which it was and stays", () => {
    // Only the money slot is promoted. `deadline` is not, and this item is not
    // a licence to make every displayed question mandatory.
    expect(REQUIRED_CHECKLIST_QUESTIONS).not.toContain("deadline");
  });
});

describe("asking it can never trap a wrap", () => {
  it("is satisfied by 'asked, and nothing was agreed'", () => {
    // The whole safety of the promotion. An empty object is a real answer —
    // the update_sow tool says to send exactly this — so a job with no prior
    // agreement clears the slot in one breath rather than holding the call.
    const state = sow({
      labour_plan: {
        people_count: 1,
        duration_days: 3,
        crew_description: "just me",
        working_dates: "week of the 15th",
      },
      pricing: { mode: "days", fixed_amount: null },
      materials_supply: { contractor_supplied: [], customer_supplied: [] },
      agreed_costs: { day_rate: null, fixed_price: null, deposit_amount: null },
    });

    expect(getUnansweredRequiredChecklistQuestions(state)).toEqual([]);
    expect(getUnansweredChecklistQuestions(state)).toEqual(["deadline"]);
  });

  it("is satisfied by a contractor declining to answer it", () => {
    const state = sow({
      labour_plan: {
        people_count: 1,
        duration_days: 3,
        crew_description: "just me",
        working_dates: "week of the 15th",
      },
      pricing: { mode: "days", fixed_amount: null },
      materials_supply: { contractor_supplied: [], customer_supplied: [] },
      declined_slots: ["agreed_costs"],
    });

    expect(getUnansweredRequiredChecklistQuestions(state)).toEqual([]);
  });

  it("records a figure when there was one", () => {
    const state = sow({
      agreed_costs: { day_rate: null, fixed_price: 2000, deposit_amount: 500 },
    });

    expect(getUnansweredChecklistQuestions(state)).not.toContain("agreed_costs");
    expect(state.agreed_costs?.deposit_amount).toBe(500);
  });
});

describe("why it matters: the send-time guard has something to compare", () => {
  it("cannot fire at all while the agreed figure is missing", () => {
    // The state of 13 of 14 production jobs. Not a judgement that the figures
    // agree — the guard simply has nothing to check.
    expect(agreedPriceDisagrees(undefined, 5000)).toBe(false);
    expect(agreedPriceDisagrees(null, 5000)).toBe(false);
  });

  it("catches the divergence once the question has been asked", () => {
    // Quote 45E0DB69's shape: one figure agreed on the call, a different one
    // on the quote the customer is asked to accept.
    expect(agreedPriceDisagrees(5000, 5)).toBe(true);
  });

  it("stays quiet when the two figures agree", () => {
    expect(agreedPriceDisagrees(5000, 5000)).toBe(false);
  });
});
