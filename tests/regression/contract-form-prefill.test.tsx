/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// The client address and phone are captured during intake and both are printed
// on the statement of work. The contract form asked for them again, empty —
// making the contractor retype what the app was already holding.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/dashboard/actions", () => ({
  createContract: vi.fn(async () => ({
    contractUrl: "",
    delivered: false,
    hadContactChannel: false,
  })),
}));

afterEach(cleanup);

const renderForm = async (
  initialJobInput?: Record<string, string>,
  timing?: {
    initialDuration?: { value: string; unit: "days" | "weeks" };
    initialStartDate?: string;
    startDateHint?: string;
  },
) => {
  const { CreateContractForm } = await import("@/app/dashboard/create-contract-form");
  render(
    <CreateContractForm
      quoteId="quote-1"
      jobId="job-1"
      customerName="A customer"
      initialJobInput={initialJobInput}
      {...timing}
    />,
  );
};

describe("CreateContractForm prefill", () => {
  it("pre-fills the captured client address and phone", async () => {
    await renderForm({
      client_address: "12 Example Road, Norwich, NR1 1AA",
      client_phone: "07700 900000",
    });

    expect(screen.getByLabelText("Client address")).toHaveProperty(
      "value",
      "12 Example Road, Norwich, NR1 1AA",
    );
    expect(screen.getByLabelText("Client phone")).toHaveProperty("value", "07700 900000");
  });

  it("leaves both editable rather than rendering them as fixed text", async () => {
    await renderForm({ client_address: "12 Example Road", client_phone: "07700 900000" });

    for (const label of ["Client address", "Client phone"]) {
      const field = screen.getByLabelText(label);
      expect(field.tagName).toBe("INPUT");
      expect((field as HTMLInputElement).readOnly).toBe(false);
      expect((field as HTMLInputElement).disabled).toBe(false);
    }
  });

  it("renders an empty, usable field when nothing was captured", async () => {
    await renderForm();

    expect(screen.getByLabelText("Client address")).toHaveProperty("value", "");
    expect(screen.getByLabelText("Client phone")).toHaveProperty("value", "");
  });
});

describe("contractPrefillFromJob", () => {
  // The defect lived HERE, not in the form: the call site handed the form only
  // scope and access notes, so address and phone could not be anything but "".
  it("carries the captured client address and phone through to the form", async () => {
    const { contractPrefillFromJob } = await import("@/lib/contract-prefill");

    const prefill = contractPrefillFromJob({
      customer: { contact: { address: "12 Example Road, Norwich, NR1 1AA", phone: "07700 900000" } },
      extracted_json: { scope_items: ["Consumer unit"], access_issues: "Side gate" },
    });

    expect(prefill.client_address).toBe("12 Example Road, Norwich, NR1 1AA");
    expect(prefill.client_phone).toBe("07700 900000");
    expect(prefill.scope_of_work).toBe("Consumer unit");
    expect(prefill.access_arrangements).toBe("Side gate");
  });

  it("yields empty usable fields when the job captured neither", async () => {
    const { contractPrefillFromJob } = await import("@/lib/contract-prefill");

    const prefill = contractPrefillFromJob({ customer: null, extracted_json: null });

    expect(prefill.client_address).toBe("");
    expect(prefill.client_phone).toBe("");
  });

  it("survives a job row that is absent entirely", async () => {
    const { contractPrefillFromJob } = await import("@/lib/contract-prefill");

    expect(contractPrefillFromJob(null)).toEqual({
      scope_of_work: "",
      access_arrangements: "",
      client_address: "",
      client_phone: "",
      // The site address the contract's work clause names. Same source as
      // client_address — one captured field — with the SOW as a fallback.
      site_address: "",
      // Derived from the captured materials-supply answer; blank when there
      // is no job at all to derive one from.
      materials_by: "",
      materials_notes: "",
    });
  });
});

describe("timing carried from the call", () => {
  // Always ahead of today, so the start picker's `min` can never make this
  // fixture go stale — and so the test says nothing about the current date.
  const nextYear = String(new Date().getFullYear() + 1);
  const START = `${nextYear}-10-01`;

  // Anchored regexes, not exact strings: the hint renders INSIDE the <label>,
  // so a field carrying one has a label whose text content is "Start dateFrom
  // the call: …". An exact match finds it only when there is no hint, which is
  // precisely the case these tests are about.
  const startDateField = () => screen.getByLabelText(/^Start date/) as HTMLInputElement;

  it("opens with the start date the call gave, not empty", async () => {
    await renderForm(undefined, { initialStartDate: START });

    expect(startDateField().value).toBe(START);
  });

  it("derives the completion date when the start and the duration are both known", async () => {
    // 1 October is a Friday in 2027 and a Thursday in 2026; the helper counts
    // working days from whichever it is, so this asserts only that SOMETHING
    // was derived — the arithmetic itself is pinned in dates.test.ts.
    await renderForm(undefined, {
      initialStartDate: START,
      initialDuration: { value: "2", unit: "weeks" },
    });

    const completion = screen.getByLabelText(/^Estimated completion/) as HTMLInputElement;
    expect(completion.value).not.toBe("");
    expect(completion.value > START).toBe(true);
    // And it says so, rather than looking like something the contractor typed.
    expect(screen.getByText(/Auto-filled from start \+ duration/)).toBeDefined();
  });

  it("shows what was said when the phrase could not be parsed", async () => {
    await renderForm(undefined, {
      startDateHint: 'From the call: "next Wednesday to Friday" — pick the start date.',
    });

    expect(startDateField().value).toBe("");
    expect(screen.getByText(/next Wednesday to Friday/)).toBeDefined();
  });

  it("keeps the generic nudge when the call said nothing about dates", async () => {
    await renderForm();

    expect(screen.getByText("Leave blank if not agreed yet.")).toBeDefined();
  });
});
