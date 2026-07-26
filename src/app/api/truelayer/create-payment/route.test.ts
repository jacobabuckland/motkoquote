import { describe, it, expect, vi, beforeEach } from "vitest";

// M9: only a live, unpaid ("sent") invoice may mint a payment link. Guarding on
// the positive state (rather than only excluding "paid") also refuses draft or
// otherwise non-payable invoices from spawning a pay-in.
const h = vi.hoisted(() => ({
  invoice: null as Record<string, unknown> | null,
  createPayment: vi.fn(async () => ({ id: "pay-1" })),
}));

vi.mock("@/lib/truelayer", () => ({
  getTrueLayerConfig: () => ({ clientId: "x" }),
  buildHostedPaymentPageUrl: () => "https://pay.truelayer.example/pay-1",
}));
vi.mock("@/lib/truelayer-payments", () => ({
  createTrueLayerPayment: h.createPayment,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // Chainable stub: reads resolve to the seeded invoice via maybeSingle; the
    // post-payment invoice update no-ops through the same chain.
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.update = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: h.invoice, error: null });
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve);
      return q;
    },
  }),
}));

import { POST } from "@/app/api/truelayer/create-payment/route";

const contractor = {
  id: "c1",
  company_name: "Acme",
  payout_details_complete: true,
  payout_account_holder_name: "Acme Ltd",
  payout_sort_code: "000000",
  payout_account_number: "12345678",
};
const invoiceWith = (status: string) => ({
  id: "inv-1",
  amount: 100,
  status,
  quote: { job: { id: "j1", contractor, customer: { name: "Alex", contact: {} } } },
});

const req = () => ({ json: async () => ({ invoiceId: "inv-1" }), nextUrl: { origin: "https://motko.app" } }) as never;

describe("create-payment — payable-state guard (M9)", () => {
  beforeEach(() => {
    h.createPayment.mockClear();
    process.env.NEXT_PUBLIC_APP_URL = "https://motko.app";
  });

  it.each(["draft", "paid", "void"])("refuses to mint a payment for a %s invoice", async (status) => {
    h.invoice = invoiceWith(status);
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Invoice is not payable" });
    expect(h.createPayment).not.toHaveBeenCalled();
  });

  it("mints a payment for a live, unpaid (sent) invoice", async () => {
    h.invoice = invoiceWith("sent");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.createPayment).toHaveBeenCalledTimes(1);
  });
});
