/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * Most UK tradespeople are sole traders, and the Company section was built for
 * the minority who are not.
 *
 * "Sole trader" was already an option — in BUSINESS_STRUCTURE_OPTIONS, rendered
 * by the Legal & contract details section, which comes AFTER the Company
 * section. So a sole trader met a Companies House search and a company number
 * field first, was asked for two things that do not exist for them, and only
 * later reached the control that says they haven't got them. Nothing keyed off
 * it either, so declaring it changed nothing.
 *
 * The server actions are mocked because this is a client component that imports
 * them, and importing the real module pulls server-only code into the test.
 */

vi.mock("@/app/setup/actions", () => ({
  autosaveContractorSetup: vi.fn(async (_input?: unknown) => ({ ok: true })),
  saveContractorSetup: vi.fn(async (_input?: unknown) => ({ ok: true })),
}));

afterEach(cleanup);

// The whole shape, not a partial. A partial literal compiles nowhere and runs
// everywhere — vitest ignores the gap and only tsc objects.
const contractor = (businessStructure?: string) => ({
  company_name: "Buckland Plastering",
  company_number: "12345678",
  trade: "Plasterer",
  vat_registered: false,
  vat_number: null,
  day_rate: null,
  half_day_rate: null,
  overtime_rate: null,
  callout_min: null,
  travel_rate: null,
  markup_pct: null,
  branding: {},
  business_profile: businessStructure
    ? { business_structure: businessStructure }
    : {},
});

const renderForm = async (businessStructure?: string) => {
  const { SetupForm } = await import("@/app/setup/setup-form");
  return render(
    <SetupForm
      merchants={[]}
      initialContractor={contractor(businessStructure)}
      initialTeamMembers={[]}
      initialMerchantAccounts={[]}
      initialRateCards={[]}
    />,
  );
};

describe("a limited company still gets the company block", () => {
  it("offers the Companies House search", async () => {
    await renderForm("Limited company");
    expect(screen.getByLabelText("Search Companies House")).toBeDefined();
  });

  it("offers the company number field", async () => {
    await renderForm("Limited company");
    expect(screen.getByLabelText(/Company number/i)).toBeDefined();
  });
});

describe("declaring sole trader collapses the company block", () => {
  it("offers the declaration in the Company section, where it is asked", async () => {
    // Not only in Legal, which comes after and asks too late to help.
    await renderForm();
    expect(screen.getByLabelText("I'm a sole trader")).toBeDefined();
  });

  it("hides the Companies House search, which can never succeed for them", async () => {
    await renderForm("Sole trader");
    expect(screen.queryByLabelText("Search Companies House")).toBeNull();
  });

  it("hides the company number, which does not exist for them", async () => {
    await renderForm("Sole trader");
    expect(screen.queryByLabelText(/Company number/i)).toBeNull();
  });

  it("keeps the business name, which they do have", async () => {
    // A sole trader still needs a name on their quotes and contracts, and
    // company_name is a required column.
    await renderForm("Sole trader");
    expect(screen.getByLabelText(/Company name/i)).toBeDefined();
  });

  it("keeps the trade, which is not a company question at all", async () => {
    // Exact, not /Trade/i — that also matches "Merchants & trade discounts".
    await renderForm("Sole trader");
    expect(screen.getByLabelText("Trade")).toBeDefined();
  });
});

describe("ticking the box takes effect immediately", () => {
  it("collapses the block without a save or a reload", async () => {
    await renderForm();
    expect(screen.getByLabelText("Search Companies House")).toBeDefined();

    fireEvent.click(screen.getByLabelText("I'm a sole trader"));

    expect(screen.queryByLabelText("Search Companies House")).toBeNull();
  });

  it("clears a company number rather than leaving it to print on a contract", async () => {
    // The contract templates emit {{company_number}} whenever it is present, so
    // a stale one would appear on a sole trader's legal documents.
    await renderForm();
    expect((screen.getByLabelText(/Company number/i) as HTMLInputElement).value).toBe(
      "12345678",
    );

    fireEvent.click(screen.getByLabelText("I'm a sole trader"));
    fireEvent.click(screen.getByLabelText("I'm a sole trader"));

    expect((screen.getByLabelText(/Company number/i) as HTMLInputElement).value).toBe("");
  });

  it("restores the block when the declaration is withdrawn", async () => {
    await renderForm("Sole trader");
    expect(screen.queryByLabelText("Search Companies House")).toBeNull();

    fireEvent.click(screen.getByLabelText("I'm a sole trader"));

    expect(screen.getByLabelText("Search Companies House")).toBeDefined();
  });
});
