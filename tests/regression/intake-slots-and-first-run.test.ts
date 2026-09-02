// V2–V5 of the first-run intake work.
//
// Three of D12's four "new" mandatory slots already existed — crew, pricing
// mode and materials supply have been required since Task D. The genuinely new
// one is the working dates: labour_plan.working_dates has been a FIELD all
// along, but nothing ever asked for it, so a customer routinely got a quote
// saying how long the job would take and never when anyone was turning up.

import { describe, expect, it } from "vitest";
import {
  buildJobIntakeInstructions,
  BASE_REALTIME_TOOLS,
} from "@/lib/voice/job-intake-prompt";
import {
  CHECKLIST_QUESTIONS,
  EMPTY_SOW_STATE,
  REQUIRED_CHECKLIST_QUESTIONS,
  getUnansweredChecklistQuestions,
  getUnansweredRequiredChecklistQuestions,
  mergeSowDelta,
  type SowState,
} from "@/lib/schemas/sow";

const withDelta = (delta: Parameters<typeof mergeSowDelta>[1]): SowState =>
  mergeSowDelta(null, delta);

describe("V2 — working dates is a required slot", () => {
  it("is required, and has a question a contractor would recognise", () => {
    expect(REQUIRED_CHECKLIST_QUESTIONS).toContain("working_dates");
    expect(CHECKLIST_QUESTIONS.working_dates).toMatch(/when/i);
  });

  it("blocks a clean wrap until it is answered", () => {
    const answeredButForDates = withDelta({
      labour_plan: { people_count: 1, duration_days: 2, crew_description: "just me" },
      pricing: { mode: "days", fixed_amount: null },
      materials_supply: { contractor_supplied: ["Cable"], customer_supplied: [] },
    });

    expect(getUnansweredRequiredChecklistQuestions(answeredButForDates)).toEqual([
      "working_dates",
    ]);
  });

  it("is satisfied by the dates alone, not by a duration or a deadline", () => {
    // The three were being collapsed. A job that takes two days, is being done
    // on the 15th, and must be finished by the 22nd is three separate facts.
    const durationOnly = withDelta({
      labour_plan: { people_count: 1, duration_days: 2, crew_description: "just me" },
    });
    expect(getUnansweredChecklistQuestions(durationOnly)).toContain("working_dates");

    const deadlineOnly = withDelta({
      deadline: { quote_by: undefined, job_by: "before the 22nd" },
    });
    expect(getUnansweredChecklistQuestions(deadlineOnly)).toContain("working_dates");

    const dated = withDelta({
      labour_plan: {
        people_count: 1,
        duration_days: null,
        crew_description: null,
        working_dates: "the 15th and 16th",
      },
    });
    expect(getUnansweredChecklistQuestions(dated)).not.toContain("working_dates");
  });
});

describe("V2/D11 — access is not a required slot", () => {
  it("never consumes a required turn", () => {
    expect(REQUIRED_CHECKLIST_QUESTIONS).not.toContain("access");
    expect(getUnansweredRequiredChecklistQuestions(EMPTY_SOW_STATE)).not.toContain("access");
  });

  it("is asked only where the job implies it matters", () => {
    const text = buildJobIntakeInstructions({ trade: "Electrician" });
    expect(text).toMatch(/Access is worth knowing about ONLY where the job implies it matters/i);
    expect(text).toMatch(/do\s+not ask about access at all/i);
  });
});

describe("V4 — a declined slot is recorded as declined, not as absent", () => {
  it("stops being asked once declined", () => {
    const declined = withDelta({ declined_slots: ["working_dates"] });

    expect(declined.declined_slots).toEqual(["working_dates"]);
    expect(getUnansweredChecklistQuestions(declined)).not.toContain("working_dates");
    expect(getUnansweredRequiredChecklistQuestions(declined)).not.toContain("working_dates");
  });

  it("is distinct from never having been asked", () => {
    // The whole point: both leave working_dates empty, and they are not the
    // same fact. One means "they told me no", the other "nobody got there".
    const untouched = withDelta({});
    expect(untouched.declined_slots).toEqual([]);
    expect(getUnansweredRequiredChecklistQuestions(untouched)).toContain("working_dates");
  });

  it("cannot be un-declined by a later turn that simply omits it", () => {
    const first = withDelta({ declined_slots: ["crew"] });
    const second = mergeSowDelta(first, { materials_mentioned: ["Cable"] });

    expect(second.declined_slots).toEqual(["crew"]);
  });

  it("accumulates without duplicating", () => {
    const first = withDelta({ declined_slots: ["crew"] });
    const second = mergeSowDelta(first, { declined_slots: ["crew", "deadline"] });

    expect(second.declined_slots).toEqual(["crew", "deadline"]);
  });

  it("tells the agent to accept a refusal first time and record it", () => {
    const text = buildJobIntakeInstructions({});
    expect(text).toMatch(/declines to answer/i);
    expect(text).toMatch(/Accept it first time\. Do not press/i);
    expect(text).toMatch(/declined_slots/);
  });
});

describe("V3 — infer and read back, rather than interrogate", () => {
  it("asks for one consolidated confirmation, not one question per slot", () => {
    const text = buildJobIntakeInstructions({});
    expect(text).toMatch(/confirm it back as part of your next sentence/i);
    expect(text).toMatch(/in ONE short sentence rather than one question/i);
  });

  it("does not let a read-back stand in for asking a required slot", () => {
    // A read-back the contractor never confirms is an inference, and the
    // must-ask invariant does not bend for it.
    const text = buildJobIntakeInstructions({});
    expect(text).toMatch(/Reading a fact back to confirm it is not inferring it/i);
  });
});

describe("V5 — a first run states the absence of history", () => {
  it("says so, and turns it into the ask", () => {
    const text = buildJobIntakeInstructions({ isFirstJob: true, hasDayRate: false });

    expect(text).toMatch(/first quote on Motko/i);
    expect(text).toMatch(/no past job and no supplier price on file/i);
    expect(text).toMatch(/Never invent a price, a rate or a supplier cost/i);
  });

  it("asks for the day rate when there isn't one, and never when there is", () => {
    const without = buildJobIntakeInstructions({ isFirstJob: true, hasDayRate: false });
    expect(without).toMatch(/no day rate saved either, so ask for it/i);

    // D10 — rates are business-level and captured once. Intake never asks for
    // a rate it already holds.
    const with_ = buildJobIntakeInstructions({ isFirstJob: true, hasDayRate: true });
    expect(with_).toMatch(/day rate IS on file, so do not ask for that one/i);
    expect(with_).not.toMatch(/no day rate saved/i);
  });

  it("says none of it to a contractor who has done this before", () => {
    const returning = buildJobIntakeInstructions({ isFirstJob: false });
    expect(returning).not.toMatch(/first quote on Motko/i);
  });

  it("still carries no retrieved past-job content, first run or not", () => {
    // The session-start retrieval defect is fixed and must stay fixed: the
    // first-run signal is a boolean, never a past job.
    for (const isFirstJob of [true, false]) {
      const text = buildJobIntakeInstructions({ isFirstJob, trade: "Electrician" });
      expect(text).not.toMatch(/Job type:/);
      expect(text).not.toMatch(/line item/i);
    }
  });
});

describe("the must-ask invariant survives the additions", () => {
  it("gates finish_job on every required slot, including the new one", () => {
    const finishJob = BASE_REALTIME_TOOLS.find((tool) => tool.name === "finish_job");
    expect(finishJob?.description).toMatch(/working dates/i);
    expect(finishJob?.description).toMatch(/not optional/i);
  });

  it("keeps the required slots outside the discretionary budget", () => {
    const text = buildJobIntakeInstructions({});
    expect(text).toMatch(/The required slots sit outside it/i);
  });
});
