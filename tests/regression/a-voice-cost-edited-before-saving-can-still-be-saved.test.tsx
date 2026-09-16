/**
 * @vitest-environment happy-dom
 */

/**
 * Editing a voice cost before it is written must create it, not update nothing.
 *
 * `CostForm` took `existingCost?: Cost`, whose `id` is required, and the job
 * page passed it a voice DRAFT — values with no row behind them — through a
 * cast. Four decisions then keyed off the object rather than off the id:
 *
 *     existingCost ? updateJobCost({ costId: existingCost.id, … }) : createJobCost(…)
 *     {existingCost ? "Edit cost" : "Add cost"}
 *     {!existingCost && !photoUrl && ( …receipt capture… )}
 *     {… : existingCost ? "Update cost" : "Add cost"}
 *
 * All four were wrong for a draft. The form called itself "Edit cost", offered
 * "Update cost", hid receipt capture, and submitted `costId: undefined` — which
 * the server rejects as "Invalid input: expected string, received undefined".
 *
 * So the Confirm button saved a voice cost and the Edit button could not, ever.
 * Reproduced twice on 16 Sep with nothing written either time, and it had been
 * that way since #679; it only became visible once the draft started arriving
 * with the right net, VAT and paid state to check.
 *
 * Prefill and persistence are different questions. The prop is now
 * `initialValues?: Partial<Cost>` and the four decisions read `initialValues.id`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  createJobCost: vi.fn(async (_input?: unknown) => ({ ok: true as const, data: { id: "cost_new" } })),
  updateJobCost: vi.fn(async (_input?: unknown) => ({ ok: true as const, data: { id: "cost_1" } })),
}));

vi.mock("@/app/jobs/[id]/cost-actions", () => actions);
vi.mock("@/app/jobs/[id]/receipt-extract-actions", () => ({
  extractReceiptData: vi.fn(async (_url?: string) => ({ ok: true as const, data: {} })),
}));
vi.mock("@/app/jobs/[id]/receipt-capture", () => ({
  ReceiptCapture: () => null,
}));

import { CostForm } from "@/app/jobs/[id]/cost-form";

afterEach(cleanup);
beforeEach(() => {
  actions.createJobCost.mockClear();
  actions.updateJobCost.mockClear();
});

// What the Edit button hands over after a voice capture: the resolved net, the
// VAT treatment and the paid state — and no id, because nothing is written yet.
const VOICE_DRAFT = {
  description: "Materials from Screwfix",
  amountNet: 10000,
  vatAmount: 2000,
  vatTreatment: "standard",
  category: "materials",
  counterpartyName: "Screwfix",
  incurredOn: "2026-09-16",
  paid: true,
};

const STORED_COST = { ...VOICE_DRAFT, id: "cost_1", paidOn: "2026-09-16" };

const renderForm = (initialValues?: Record<string, unknown>) =>
  render(
    <CostForm
      jobId="job_1"
      userId="user_1"
      initialValues={initialValues as never}
      existingCounterparties={[]}
      defaultVatTreatment="standard"
      onClose={() => {}}
    />,
  );

const submit = async () => {
  fireEvent.submit(screen.getByRole("button", { name: /Add cost|Update cost|Confirm and save/ }).closest("form")!);
  // Let the submit handler's awaits settle.
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("a voice draft that has never been written", () => {
  it("creates the cost rather than updating a row that does not exist", async () => {
    renderForm(VOICE_DRAFT);
    await submit();

    expect(actions.updateJobCost, "costId would be undefined").not.toHaveBeenCalled();
    expect(actions.createJobCost).toHaveBeenCalledTimes(1);
  });

  it("creates it with the net, VAT treatment and paid state the draft carried", async () => {
    renderForm(VOICE_DRAFT);
    await submit();

    const payload = actions.createJobCost.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.amountNet, "£100 net, not the £120 gross").toBe(10000);
    expect(payload.vatTreatment).toBe("standard");
    expect(payload.paid).toBe(true);
  });

  it("does not call itself an edit", () => {
    renderForm(VOICE_DRAFT);

    expect(screen.getByRole("heading", { name: "Add cost" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Update cost" })).toBeNull();
  });

  it("still offers receipt capture, because this is a new cost", () => {
    renderForm(VOICE_DRAFT);

    expect(screen.getByRole("button", { name: /receipt/i })).toBeDefined();
  });
});

describe("a cost that really is stored", () => {
  it("updates it, by its own id", async () => {
    renderForm(STORED_COST);
    await submit();

    expect(actions.createJobCost).not.toHaveBeenCalled();
    expect(actions.updateJobCost).toHaveBeenCalledTimes(1);
    const payload = actions.updateJobCost.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.costId).toBe("cost_1");
  });

  it("calls itself an edit", () => {
    renderForm(STORED_COST);

    expect(screen.getByRole("heading", { name: "Edit cost" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Update cost" })).toBeDefined();
  });
});

describe("an empty form", () => {
  it("creates, and prefills nothing", async () => {
    renderForm(undefined);

    expect((screen.getByLabelText("Amount (£)") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("heading", { name: "Add cost" })).toBeDefined();
  });
});
