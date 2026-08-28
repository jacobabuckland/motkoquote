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

const renderForm = async (initialJobInput?: Record<string, string>) => {
  const { CreateContractForm } = await import("@/app/dashboard/create-contract-form");
  render(
    <CreateContractForm
      quoteId="quote-1"
      jobId="job-1"
      customerName="A customer"
      initialJobInput={initialJobInput}
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
    });
  });
});
