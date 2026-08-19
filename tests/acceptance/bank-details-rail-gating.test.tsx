/**
 * @vitest-environment happy-dom
 *
 * Acceptance: bank-transfer details render only when the Stripe rail cannot
 * take the payment.
 *
 * Under PAY-4 fee-at-source motko earns only when money moves through the
 * rail. Two surfaces handed the customer a fee-free route around it:
 *
 *   1. The invoice page shipped the sort code and account number inside a
 *      <details> toggle beside the pay button — present in the response body
 *      whether or not the customer expanded it.
 *   2. Every contract template renders {{bank_details}}, gated only on payout
 *      setup and never on rail availability — on a document the customer keeps,
 *      before the invoice exists.
 *
 * PAY-8 recommends exactly this gating, and its constraint carries: a £15k
 * invoice must remain payable, so above-ceiling and no-rail invoices keep the
 * details.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { buildPayPanel, type PayPanelInput } from "@/app/i/[id]/pay-panel";
import { buildContractVariables } from "@/lib/contracts/build-variables";
import { CONTRACT_TEMPLATES } from "@/lib/contracts/templates";
import { renderContractTemplate } from "@/lib/contracts/render-template";
import type { ContractJobInput } from "@/lib/schemas/contract";

afterEach(cleanup);

const base: PayPanelInput = {
  railsAvailable: true,
  payoutDetailsComplete: true,
  accountHolderName: "Acme Ltd",
  sortCode: "123456",
  accountNumber: "12345678",
  companyName: "Acme Ltd",
  firstName: "Dave",
  amount: 8132.14,
  invoiceId: "a1b2c3d4-e5f6-4000-8000-000000000001",
};

describe("buildPayPanel — the rail decides whether details exist at all", () => {
  it("produces NO transfer details when the rail is available and the amount is under the ceiling", () => {
    const panel = buildPayPanel(base);
    expect(panel.mode).toBe("button_only");
    expect("transfer" in panel).toBe(false);
  });

  it("keeps full details when the contractor has no working rail", () => {
    const panel = buildPayPanel({ ...base, railsAvailable: false });
    if (panel.mode !== "transfer_only") throw new Error("expected transfer_only");
    expect(panel.transfer.sortCode).toBe("12-34-56");
    expect(panel.transfer.accountNumber).toBe("12345678");
  });

  it("keeps full details above the £10k ceiling even with a live rail — a £15k invoice stays payable", () => {
    const panel = buildPayPanel({ ...base, amount: 15_000 });
    if (panel.mode !== "transfer_only") throw new Error("expected transfer_only");
    expect(panel.transfer.accountNumber).toBe("12345678");
  });

  it("still collapses to setup_incomplete when payout details are missing", () => {
    for (const patch of [
      { payoutDetailsComplete: false },
      { accountHolderName: null },
      { sortCode: null },
      { accountNumber: null },
    ] as Array<Partial<PayPanelInput>>) {
      for (const railsAvailable of [true, false]) {
        expect(buildPayPanel({ ...base, railsAvailable, ...patch }).mode).toBe(
          "setup_incomplete",
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The contract surface
// ---------------------------------------------------------------------------
const contractorBase = {
  company_name: "Acme Ltd",
  company_number: null,
  trade: "Electrician",
  vat_registered: false,
  vat_number: null,
  business_profile: {},
  payout_account_holder_name: "Acme Ltd",
  payout_sort_code: "123456",
  payout_account_number: "12345678",
  payout_details_complete: true,
  stripe_account_id: null as string | null,
  stripe_payouts_enabled: false,
};

const varsFor = (contractor: typeof contractorBase) =>
  buildContractVariables({
    contractor,
    customer: { name: "Jane Client", contact: {} },
    lineItems: [],
    quoteReference: "ABCD1234",
    depositAmount: null,
    jobInput: {} as ContractJobInput,
  });

describe("contract {{bank_details}} is gated on the same rail check", () => {
  it("prints nothing when the contractor can take a Stripe charge", () => {
    const vars = varsFor({
      ...contractorBase,
      stripe_account_id: "acct_123",
      stripe_payouts_enabled: true,
    });
    expect(vars.bank_details).toBe("");
  });

  it("prints the account when the contractor has no Connect account", () => {
    expect(varsFor(contractorBase).bank_details).toContain("12345678");
  });

  it("prints the account for a contractor MID-VERIFICATION — has an account, cannot charge", () => {
    // The case that makes account-existence the wrong gate. Gating on
    // stripe_account_id being non-null would hide the details from someone who
    // has no working rail, leaving their customer no way to pay at all.
    const vars = varsFor({
      ...contractorBase,
      stripe_account_id: "acct_123",
      stripe_payouts_enabled: false,
    });
    expect(vars.bank_details).toContain("12345678");
  });

  it.each(CONTRACT_TEMPLATES.map((t) => t.key))(
    "%s collapses its payment-details clause cleanly when bank_details is empty",
    (key) => {
      const template = CONTRACT_TEMPLATES.find((t) => t.key === key);
      const vars = varsFor({
        ...contractorBase,
        stripe_account_id: "acct_123",
        stripe_payouts_enabled: true,
      });
      const output = renderContractTemplate(template!.body, vars);

      // The section vanishes entirely rather than leaving a dangling label.
      expect(output).not.toMatch(/Payment details:\s*\./);
      expect(output).not.toMatch(/Details:\s*\./);
      expect(output).not.toContain("{{");
    },
  );
});

// ---------------------------------------------------------------------------
// The on-demand fallback
// ---------------------------------------------------------------------------
const invoiceRow = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: invoiceRow.current, error: null }),
      };
      return b;
    },
  }),
}));

const payableRow = {
  amount: 8132.14,
  status: "sent",
  quote: {
    job: {
      contractor: {
        payout_details_complete: true,
        payout_account_holder_name: "Acme Ltd",
        payout_sort_code: "123456",
        payout_account_number: "12345678",
      },
    },
  },
};

const callTransfer = async (id = "a1b2c3d4-e5f6-4000-8000-000000000001") => {
  const { GET } = await import("@/app/api/invoices/[id]/transfer-details/route");
  return GET({} as never, { params: Promise.resolve({ id }) });
};

describe("GET /api/invoices/[id]/transfer-details", () => {
  it("serves the payee account for an unpaid invoice", async () => {
    invoiceRow.current = payableRow;
    const body = await (await callTransfer()).json();
    expect(body.sortCode).toBe("12-34-56");
    expect(body.accountNumber).toBe("12345678");
  });

  it("formats identically to the transfer_only panel, so the two paths cannot disagree", async () => {
    invoiceRow.current = payableRow;
    const body = await (await callTransfer()).json();
    const panel = buildPayPanel({ ...base, railsAvailable: false });
    if (panel.mode !== "transfer_only") throw new Error("expected transfer_only");
    expect(body).toEqual(panel.transfer);
  });

  it.each([
    ["unknown invoice", null],
    ["already paid", { ...payableRow, status: "paid" }],
    [
      "payout setup incomplete",
      {
        ...payableRow,
        quote: { job: { contractor: { ...payableRow.quote.job.contractor, payout_details_complete: false } } },
      },
    ],
  ])("404s indistinguishably: %s", async (_label, row) => {
    invoiceRow.current = row as Record<string, unknown> | null;
    const res = await callTransfer();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("is never cached and never leaks into the referrer chain", async () => {
    invoiceRow.current = payableRow;
    const res = await callTransfer();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});

describe("PayButton reveals the fallback only after a failed attempt", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  it("offers no bank-transfer route before anything has failed", async () => {
    const { PayButton } = await import("@/app/i/[id]/pay-button");
    render(<PayButton invoiceId="inv-1" amount={100} companyName="Acme Ltd" />);

    expect(screen.queryByText("Pay by bank transfer instead")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers it once the Payment Intent is refused, and fetches nothing until asked", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: "too high", code: "AMOUNT_TOO_HIGH" }),
    } as Response);

    const { PayButton } = await import("@/app/i/[id]/pay-button");
    render(<PayButton invoiceId="inv-1" amount={20000} companyName="Acme Ltd" />);

    screen.getByRole("button", { name: /Pay/ }).click();

    await waitFor(() =>
      expect(screen.getByText("Pay by bank transfer instead")).toBeTruthy(),
    );
    // Still only the create-payment-intent call — details are not pre-fetched.
    expect(fetchMock.mock.calls).toHaveLength(1);
  });
});
