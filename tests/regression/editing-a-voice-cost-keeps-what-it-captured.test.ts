/**
 * Tapping Edit on a voice cost must not undo the capture.
 *
 * Voice cost capture learned to record what was said about VAT and about
 * payment (#789). Two paths lead out of the confirmation screen and only one
 * of them was taught:
 *
 *   Confirm → completeCostCapture → resolveCostBasis → £100 net + £20 VAT, paid
 *   Edit    → /jobs/[id]?editDraft=true&…           → £120 net, unpaid
 *
 * The Edit link carried five fields — amount, counterparty, category, date,
 * description — and the receiving form derived the rest. All three derivations
 * were wrong for a voice draft:
 *
 *   * `amountNet` was taken from the amount the contractor SAID, which on "one
 *     hundred and twenty on the card" is the gross. £20 of reclaimable VAT
 *     vanished — the defect cost-vat-basis.ts exists to stop, reached by
 *     tapping the other button.
 *   * `vatTreatment` was derived from whether the CONTRACTOR is VAT registered.
 *     That is not the question: whether a cost carries VAT depends on the
 *     supplier who issued it, so a helper who is not registered is zero-rated
 *     however the contractor is set up.
 *   * `paid` was hardcoded false, discarding "paid it on the card".
 *
 * The split is now resolved once, at draft time, by the same function the
 * server uses — so the figure shown for confirmation, the figure handed to the
 * form and the figure written cannot disagree.
 */

import { describe, expect, it } from "vitest";
import { buildDraftFromToolArgs } from "@/lib/voice/draft-cost";
import type { JobSummary } from "@/lib/match-job";

const JOBS: JobSummary[] = [
  { id: "job_1", customer_name: "Henderson", created_at: "2026-09-01T00:00:00Z" },
];

const TODAY = "2026-09-16";

const draftFor = (overrides: Record<string, unknown>) => {
  const outcome = buildDraftFromToolArgs(
    {
      amount_words: "one hundred and twenty pounds",
      amount_basis: "gross",
      vat_treatment: "standard",
      vat_amount_words: null,
      paid: true,
      counterparty_name: "Screwfix",
      category: "materials",
      job_spoken_words: "the Henderson job",
      description: "Materials from Screwfix",
      ...overrides,
    } as never,
    TODAY,
    JOBS,
  );
  if (!outcome.ok) throw new Error(`draft refused: ${outcome.error}`);
  return outcome.draft;
};

describe("the card purchase that used to be filed as net", () => {
  it("carries the net and the VAT, not just the figure that was said", () => {
    const draft = draftFor({});

    expect(draft.amountPence, "what they said").toBe(12000);
    expect(draft.amountNet, "what the job actually cost").toBe(10000);
    expect(draft.vatAmount, "what is reclaimable").toBe(2000);
  });

  it("keeps the paid state that was stated", () => {
    expect(draftFor({}).paid).toBe(true);
    expect(draftFor({ paid: false }).paid).toBe(false);
    expect(draftFor({ paid: null }).paid).toBeNull();
  });
});

describe("the helper who is not VAT registered", () => {
  it("is zero-rated on the contractor's own numbers, whatever the contractor is", () => {
    const draft = draftFor({
      amount_words: "one hundred and sixty pounds",
      amount_basis: "unknown",
      vat_treatment: "zero",
      category: "labour",
    });

    expect(draft.vatTreatment).toBe("zero");
    expect(draft.amountNet).toBe(16000);
    expect(draft.vatAmount).toBe(0);
  });
});

describe("an amount whose basis nobody gave", () => {
  it("carries no split, so nothing downstream can invent one", () => {
    // The server refuses this case and the assistant asks. The draft must not
    // quietly supply a number in the meantime.
    const draft = draftFor({ amount_basis: "unknown", vat_treatment: "standard" });

    expect(draft.amountNet).toBeNull();
    expect(draft.vatAmount).toBeNull();
  });
});

describe("the link the Edit button builds", () => {
  // The component builds this inline; this is the same construction, asserted
  // on the values it is given, so a field dropped from the draft is caught here
  // rather than on a contractor's screen.
  const editParams = (draft: ReturnType<typeof draftFor>) =>
    new URLSearchParams({
      editDraft: "true",
      amountPence: String(draft.amountPence),
      counterpartyName: draft.counterpartyName ?? "",
      category: draft.category,
      incurredOn: draft.incurredOn,
      description: draft.description,
      vatTreatment: draft.vatTreatment,
      ...(draft.amountNet !== null ? { amountNet: String(draft.amountNet) } : {}),
      ...(draft.vatAmount !== null ? { vatAmount: String(draft.vatAmount) } : {}),
      ...(draft.paid !== null ? { paid: draft.paid ? "true" : "false" } : {}),
    });

  it("hands the form the net, the VAT, the treatment and the paid state", () => {
    const params = editParams(draftFor({}));

    expect(params.get("amountNet"), "not the £120 gross").toBe("10000");
    expect(params.get("vatAmount")).toBe("2000");
    expect(params.get("vatTreatment")).toBe("standard");
    expect(params.get("paid")).toBe("true");
  });

  it("omits what was never established, rather than asserting a default", () => {
    const params = editParams(draftFor({ amount_basis: "unknown", vat_treatment: "standard", paid: null }));

    expect(params.has("amountNet")).toBe(false);
    expect(params.has("vatAmount")).toBe(false);
    expect(params.has("paid")).toBe(false);
    // The form's own fallback then applies, which is the pre-existing behaviour
    // for any caller that does not send these.
  });
});
