import { describe, expect, it, vi, beforeEach } from "vitest";

// Top-level mocks per vitest requirements
const h = vi.hoisted(() => {
  const notify = vi.fn(async (_contractorId?: unknown, _payload?: unknown) => {});
  const track = vi.fn(async () => {});
  const state: {
    quoteRow: unknown;
    contractRow: unknown;
    updateCalls: Array<{ viewed_at?: string }>;
  } = {
    quoteRow: null,
    contractRow: null,
    updateCalls: [],
  };

  const createAdminClient = () => ({
    from: (table: string) => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        neq: vi.fn(() => builder),
        single: vi.fn(async () => {
          if (table === "contracts") {
            return { data: state.contractRow, error: null };
          }
          return { data: null, error: null };
        }),
        maybeSingle: vi.fn(async () => {
          if (table === "quotes") {
            return { data: state.quoteRow, error: null };
          }
          if (table === "contracts") {
            return { data: state.contractRow, error: null };
          }
          return { data: null, error: null };
        }),
        update: vi.fn((data: { viewed_at?: string }) => {
          state.updateCalls.push(data);
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => Promise.resolve({ data: [{ id: "updated" }], error: null })),
              })),
            })),
          };
        }),
      };
      return builder;
    },
  });

  return { notify, track, state, createAdminClient };
});

vi.mock("@/lib/notify-contractor", () => ({
  notifyContractorOfCustomerAction: h.notify,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: h.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

vi.mock("@/lib/analytics", () => ({
  track: h.track,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));

vi.mock("@/lib/erased-artefact", () => ({
  isPubliclyUnavailable: () => false,
}));

vi.mock("@/lib/query-error", () => ({
  throwIfQueryFailed: async () => {},
}));

vi.mock("@/lib/invoicing", () => ({
  createInvoiceRecord: vi.fn(async () => {}),
}));

describe("NOTIF-2: Launch-critical notification events", () => {
  beforeEach(() => {
    h.notify.mockClear();
    h.track.mockClear();
    h.state.updateCalls = [];
  });

  describe("quote_viewed event exists", () => {
    it("appears in the notification events array", async () => {
      const { notificationEvents } = await import("@/lib/schemas/notification");
      expect(notificationEvents).toContain("quote_viewed");
    });

    it("has a label in notificationEventLabels", async () => {
      const { notificationEventLabels } = await import("@/lib/schemas/notification");
      expect(notificationEventLabels.quote_viewed).toBeDefined();
      expect(typeof notificationEventLabels.quote_viewed).toBe("string");
    });
  });

  describe("quote page sends notification on first view", () => {
    beforeEach(() => {
      h.state.quoteRow = {
        id: "q-123",
        line_items_json: [{ description: "Labour", quantity: 1, unit_price: 100 }],
        status: "sent",
        viewed_at: null,
        sent_total: 100,
        job: {
          customer: { name: "Alice" },
          contractor: {
            company_name: "Bob's Builds",
            vat_registered: false,
            branding: null,
            erased_at: null,
          },
        },
      };
    });

    it("sends quote_viewed notification when a sent quote is viewed for the first time", async () => {
      const { default: PublicQuotePage } = await import("@/app/q/[id]/page");

      await PublicQuotePage({ params: Promise.resolve({ id: "q-123" }) });

      expect(h.notify).toHaveBeenCalledTimes(1);
      expect(h.notify).toHaveBeenCalledWith(expect.anything(), {
        jobId: expect.any(String),
        event: "quote_viewed",
        subject: expect.stringContaining("Alice"),
        heading: expect.stringContaining("Alice"),
        nextStep: expect.any(String),
      });
    });

    it("includes the customer name in the notification", async () => {
      const { default: PublicQuotePage } = await import("@/app/q/[id]/page");

      await PublicQuotePage({ params: Promise.resolve({ id: "q-123" }) });

      const call = h.notify.mock.calls[0];
      expect(call).toBeDefined();
      if (call) {
        const [, payload] = call as [unknown, { subject: string; heading: string }];
        expect(payload.subject).toMatch(/Alice/);
        expect(payload.heading).toMatch(/Alice/);
      }
    });

    it("does not send notification if quote was already viewed", async () => {
      h.state.quoteRow = {
        ...(h.state.quoteRow as Record<string, unknown>),
        viewed_at: "2026-09-01T10:00:00Z",
      };

      const { default: PublicQuotePage } = await import("@/app/q/[id]/page");

      await PublicQuotePage({ params: Promise.resolve({ id: "q-123" }) });

      expect(h.notify).not.toHaveBeenCalled();
    });

    it("does not send notification for draft quotes", async () => {
      h.state.quoteRow = {
        ...(h.state.quoteRow as Record<string, unknown>),
        status: "draft",
        viewed_at: null,
      };

      const { default: PublicQuotePage } = await import("@/app/q/[id]/page");

      await PublicQuotePage({ params: Promise.resolve({ id: "q-123" }) });

      expect(h.notify).not.toHaveBeenCalled();
    });

    it("renders 'Your customer' when customer name is missing", async () => {
      h.state.quoteRow = {
        id: "q-123",
        line_items_json: [{ description: "Labour", quantity: 1, unit_price: 100 }],
        status: "sent",
        viewed_at: null,
        sent_total: 100,
        job: {
          customer: null,
          contractor: {
            company_name: "Bob's Builds",
            vat_registered: false,
            branding: null,
            erased_at: null,
          },
        },
      };

      const { default: PublicQuotePage } = await import("@/app/q/[id]/page");

      await PublicQuotePage({ params: Promise.resolve({ id: "q-123" }) });

      expect(h.notify).toHaveBeenCalledTimes(1);
      const call = h.notify.mock.calls[0];
      expect(call).toBeDefined();
      if (call) {
        const [, payload] = call as [unknown, { subject: string }];
        expect(payload.subject).toMatch(/Your customer/);
      }
    });
  });

  describe("existing notification events still work (regression)", () => {
    beforeEach(() => {
      h.state.quoteRow = {
        job_id: "job-789",
        job: { customer: { name: "Bob" } },
        line_items_json: [{ description: "Labour", quantity: 1, unit_price: 200 }],
      };
    });

    it("quote accepted still sends notification", async () => {
      const { acceptQuote } = await import("@/app/q/[id]/actions");

      await acceptQuote("q-456");

      expect(h.notify).toHaveBeenCalledTimes(1);
      expect(h.notify).toHaveBeenCalledWith(expect.anything(), {
        jobId: "job-789",
        event: "quote_accepted",
        subject: expect.stringContaining("Bob"),
        heading: expect.stringContaining("Bob"),
        nextStep: expect.any(String),
      });
    });

    it("quote declined still sends notification", async () => {
      const { declineQuote } = await import("@/app/q/[id]/actions");

      await declineQuote("q-456");

      expect(h.notify).toHaveBeenCalledTimes(1);
      expect(h.notify).toHaveBeenCalledWith(expect.anything(), {
        jobId: "job-789",
        event: "quote_declined",
        subject: expect.stringContaining("Bob"),
        heading: expect.stringContaining("Bob"),
        nextStep: expect.any(String),
      });
    });
  });

  describe("contract events still work (regression)", () => {
    beforeEach(() => {
      h.state.contractRow = {
        status: "sent",
        deposit_pct: null,
        quote: {
          id: "q-999",
          total: 1000,
          job: {
            id: "job-999",
            customer: { name: "Charlie", contact: {} },
            contractor: {
              company_name: "Dave's Carpentry",
              payout_details_complete: true,
            },
          },
        },
      };
    });

    it("contract signed still sends notification", async () => {
      const { signContract } = await import("@/app/c/[id]/actions");

      await signContract("c-789", "Charlie Smith");

      expect(h.notify).toHaveBeenCalledTimes(1);
      expect(h.notify).toHaveBeenCalledWith(expect.anything(), {
        jobId: "job-999",
        event: "contract_signed",
        subject: expect.stringContaining("Charlie"),
        heading: expect.stringContaining("Charlie"),
        nextStep: expect.any(String),
      });
    });

    it("contract declined still sends notification", async () => {
      const { declineContract } = await import("@/app/c/[id]/actions");

      await declineContract("c-789");

      expect(h.notify).toHaveBeenCalledTimes(1);
      expect(h.notify).toHaveBeenCalledWith(expect.anything(), {
        jobId: "job-999",
        event: "contract_declined",
        subject: expect.stringContaining("Charlie"),
        heading: expect.stringContaining("Charlie"),
        nextStep: expect.any(String),
      });
    });
  });
});
