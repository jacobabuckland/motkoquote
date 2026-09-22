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
      // Answered here so this test keeps asserting what it is about — that
      // working_dates ALONE blocks the wrap. P2-13 promoted agreed_costs to a
      // required slot; supplying it leaves the assertion untouched, rather than
      // widening the expectation and quietly testing something looser.
      agreed_costs: { day_rate: null, fixed_price: null, deposit_amount: null, nothing_agreed: true },
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

// Reported 21 Sep. The contractor listed their materials — "three bags of
// plaster, two sets of scrim tape, and some other ancillary stuff" — was told
// "that's noted", and was never asked what any of it costs.
//
// The materials slot asks THREE things and the price is not one of them. #749
// widened it to "who supplies, HOW MUCH, and what specifically", and "how much
// are we talking" is a quantity: it lands in `quantity_guidance`. So the whole
// slot can be answered, and satisfied, with no figure anywhere.
//
// That is not a gap the drafting stage can close. Motko never invents a
// material price (D16), so nobody asking means nobody charging: every material
// line comes back "Not priced — add what you charge for this", for the
// contractor to fill in by hand on a quote they have just talked through.
//
// NOT a sixth required slot, deliberately. tests/acceptance/749.test.ts pins
// REQUIRED_CHECKLIST_QUESTIONS at exactly five, and a frozen contract is not
// an implementer's to retire. The ask is added to the slot that already
// covers materials, where it belongs anyway — one question about materials,
// not two.
describe("what the materials cost is a slot of its own", () => {
  it("is required, and has a question a contractor would recognise", () => {
    expect(REQUIRED_CHECKLIST_QUESTIONS).toContain("material_prices");
    expect(CHECKLIST_QUESTIONS.material_prices).toMatch(/charge for the materials/i);
    // Either shape of answer, because a trade gives either.
    expect(CHECKLIST_QUESTIONS.material_prices).toMatch(/each|total for the lot/i);
  });

  it("leaves the supply question doing its own job", () => {
    // It was tried as a fourth clause there and taken back out: that question
    // already carries three, and a fourth is the one dropped in the answer --
    // which is how the price came to be missing in the first place.
    expect(CHECKLIST_QUESTIONS.materials_supply).toMatch(/who's supplying/i);
    expect(CHECKLIST_QUESTIONS.materials_supply).not.toMatch(/charge/i);
  });

  it("is outstanding on a job with materials and no figure anywhere", () => {
    const sow = withDelta({
      materials_mentioned: ["Multi-finish plaster", "Scrim tape"],
      materials_supply: { responsibility: "contractor", contractor_supplied: ["Multi-finish plaster"] },
    });

    expect(getUnansweredRequiredChecklistQuestions(sow)).toContain("material_prices");
  });

  it.each([
    [
      "nothing was named",
      { materials_supply: { responsibility: "contractor" as const, contractor_supplied: [] } },
    ],
    [
      "the customer buys the lot",
      {
        materials_mentioned: ["Multi-finish plaster"],
        materials_supply: { responsibility: "customer" as const, customer_supplied: ["Multi-finish plaster"] },
      },
    ],
    [
      "the whole job has a fixed price",
      {
        materials_mentioned: ["Multi-finish plaster"],
        materials_supply: { responsibility: "contractor" as const, contractor_supplied: ["Multi-finish plaster"] },
        pricing: { mode: "fixed" as const, fixed_amount: 2000 },
      },
    ],
  ])("is not asked when %s", (_case, delta) => {
    expect(getUnansweredRequiredChecklistQuestions(withDelta(delta))).not.toContain(
      "material_prices",
    );
  });

  it("is answered by a figure the contractor gave", () => {
    const sow = withDelta({
      materials_mentioned: ["Multi-finish plaster"],
      materials_supply: { responsibility: "contractor", contractor_supplied: ["Multi-finish plaster"] },
      stated_prices: [
        {
          amount: 1200,
          item: "Multi-finish plaster",
          transcript_span: "twelve pounds a bag",
          qualifiers: { each: true, fitted: false, already_paid: false, excluded: false },
          superseded_by: null,
          refused: false,
        },
      ],
    });

    expect(getUnansweredRequiredChecklistQuestions(sow)).not.toContain("material_prices");
  });

  it("is answered by a decline, so a deferred price cannot trap a wrap", () => {
    // "I haven't got the material price yet, leave it unconfirmed" is an
    // ordinary thing for a trade to say, and the quote carries the line
    // unpriced on purpose (#848).
    const sow = withDelta({
      materials_mentioned: ["Multi-finish plaster"],
      materials_supply: { responsibility: "contractor", contractor_supplied: ["Multi-finish plaster"] },
      declined_slots: ["material_prices"],
    });

    expect(getUnansweredRequiredChecklistQuestions(sow)).not.toContain("material_prices");
  });

  it("tells the model it is the half that gets forgotten, and not to press", () => {
    const text = buildJobIntakeInstructions({});

    expect(text).toMatch(/materials are TWO slots/i);
    expect(text).toMatch(/never invents a material price/i);
    expect(text).toMatch(/sort the price later[\s\S]*accept that first time/i);
  });

  it("gates finish_job on it", () => {
    const finishJob = BASE_REALTIME_TOOLS.find((tool) => tool.name === "finish_job");

    expect(finishJob?.description).toMatch(/what those materials cost/i);
  });
});
