import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { join } from "node:path";
import type { NextRequest } from "next/server";

// Stub Supabase client that returns stage and invoice fixtures
const createTestClient = () => {
  const mockSelect: Mock = vi.fn();
  const maybeSingle = vi.fn();
  const single = vi.fn();
  const mockInsert: Mock = vi.fn(() => ({ select: mockSelect, single }));

  // PostgREST's query builder is chainable AND awaitable: every filter returns
  // the builder itself, and awaiting the builder runs the query. A stub whose
  // select() hands back a bare promise therefore breaks on the first filter the
  // route chains onto it — `.select(...).eq(...)` is `undefined.eq`.
  //
  // `mockSelect` still supplies the rows and still records the call, so tests
  // queue results with mockResolvedValueOnce exactly as before.
  const buildQuery = (result: unknown) => {
    const builder: Record<string, unknown> = {
      maybeSingle,
      single,
      then: (
        onFulfilled?: ((value: unknown) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => Promise.resolve(result).then(onFulfilled, onRejected),
    };
    for (const method of [
      "eq", "neq", "not", "is", "in", "gt", "gte", "lt", "lte",
      "order", "limit", "range", "filter", "or", "select", "match",
    ]) {
      builder[method] = vi.fn(() => builder);
    }
    return builder;
  };

  const mockEq = vi.fn(() => buildQuery({ data: null, error: null }));
  const mockDelete = vi.fn(() => ({ eq: mockEq }));

  const from = vi.fn((table?: string) => {
    if (table === "cron_locks") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
        insert: () => Promise.resolve({ data: { name: "chase" }, error: null }),
        delete: () => ({ eq: () => Promise.resolve() }),
      };
    }
    return {
      select: vi.fn((...args: unknown[]) => buildQuery(mockSelect(...args))),
      insert: mockInsert,
      eq: mockEq,
      delete: mockDelete,
      not: vi.fn(() => buildQuery(mockSelect())),
    };
  });

  type MockClient = { from: typeof from };
  const client = { from } as MockClient;
  return { client, mockSelect, mockInsert, mockEq, mockDelete };
};

describe("STAGE-3: Extend automatic chasing to unsettled stages", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  describe("Database schema", () => {
    it("adds due_date column to payment_stages table", async () => {
      const migrationPath = join(
        process.cwd(),
        "supabase/migrations/00000000000072_stage_due_date_and_chase_events.sql"
      );
      const { readFileSync } = await import("node:fs");
      const migration = readFileSync(migrationPath, "utf-8");

      expect(migration).toContain("alter table payment_stages");
      expect(migration).toContain("add column due_date");
    });

    it("adds stage_id column to chase_events table", async () => {
      const migrationPath = join(
        process.cwd(),
        "supabase/migrations/00000000000072_stage_due_date_and_chase_events.sql"
      );
      const { readFileSync } = await import("node:fs");
      const migration = readFileSync(migrationPath, "utf-8");

      expect(migration).toContain("alter table chase_events");
      expect(migration).toContain("add column stage_id");
      expect(migration).toContain("references payment_stages");
    });

    it("makes invoice_id nullable on chase_events with check exactly one of invoice_id or stage_id is set", async () => {
      const migrationPath = join(
        process.cwd(),
        "supabase/migrations/00000000000072_stage_due_date_and_chase_events.sql"
      );
      const { readFileSync } = await import("node:fs");
      const migration = readFileSync(migrationPath, "utf-8");

      // The migration must make invoice_id nullable
      expect(migration).toMatch(/alter column invoice_id drop not null/i);

      // And add a check that exactly one is set
      expect(migration).toMatch(/add constraint.*check/i);
      expect(migration).toContain("(invoice_id is null) <> (stage_id is null)");
    });
  });

  describe("Chase planning for stages", () => {
    it("plans a chase for an overdue stage with no invoice", async () => {
      const { planChase } = await import("@/lib/chase-plan");

      // Stage due 10 days ago, no chases sent yet
      const dueDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const plan = planChase(dueDate, [], Date.now());

      expect(plan.action).toBe("send");
      if (plan.action === "send") {
        expect(plan.template).toBe("day_7");
        expect(plan.daysOverdue).toBe(10);
      }
    });

    it("does not plan a chase for a stage with no due_date", async () => {
      const { planChase } = await import("@/lib/chase-plan");

      const plan = planChase(null, [], Date.now());

      expect(plan.action).toBe("none");
    });

    it("does not plan a chase for a stage not yet overdue", async () => {
      const { planChase } = await import("@/lib/chase-plan");

      // Stage due tomorrow
      const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const plan = planChase(dueDate, [], Date.now());

      expect(plan.action).toBe("none");
    });
  });

  describe("Chase cron route", () => {
    it("chases an overdue stage with no invoice", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://motko.app");
      vi.stubEnv("POSTMARK_API_TOKEN", "test-token");

      const stage = {
        id: "stage-1",
        job_id: "job-1",
        stage_number: 1,
        amount_pennies: 500000,
        due_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        invoice_id: null,
        settled_at: null,
        job: {
          id: "job-1",
          archived_at: null,
          quote: {
            status: "accepted",
          },
          customer: {
            name: "Jane Smith",
            contact: { email: "jane@example.com" },
          },
          contractor: {
            company_name: "Smith Plumbing",
          },
        },
        chase_events: [],
      };

      const { client, mockSelect, mockInsert } = createTestClient();
      mockSelect.mockResolvedValueOnce({ data: [] }); // no invoices
      mockSelect.mockResolvedValueOnce({ data: [stage] }); // one stage
      mockInsert.mockResolvedValueOnce({ error: null }); // claim succeeds

      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => client,
      }));

      vi.doMock("@/lib/email", () => ({
        sendChaseEmail: vi.fn(async () => ({ delivered: true })),
      }));

      vi.doMock("@/lib/sms", () => ({
        sendChaseSms: vi.fn(async () => ({ delivered: true })),
      }));

      vi.doMock("@/lib/chase", () => ({
        draftChaseMessage: vi.fn(async () => "Your payment is overdue."),
      }));

      const { GET } = await import("@/app/api/cron/chase/route");
      const request = new Request("https://motko.app/api/cron/chase", {
        headers: { authorization: "Bearer test" },
      });

      vi.doMock("@/lib/cron-auth", () => ({
        rejectUnauthorizedCron: vi.fn(() => null),
      }));

      const response = await GET(request as unknown as NextRequest);
      const data = await response.json();

      expect(data.sent).toBeGreaterThan(0);
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          stage_id: "stage-1",
          channel: "email",
        })
      );
    });

    it("does not chase a stage that has an invoice_id", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://motko.app");

      const stage = {
        id: "stage-1",
        job_id: "job-1",
        stage_number: 1,
        amount_pennies: 500000,
        due_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        invoice_id: "invoice-1", // has invoice, so excluded from stage chase
        settled_at: null,
        job: {
          id: "job-1",
          archived_at: null,
          quote: { status: "accepted" },
          customer: { name: "Jane Smith", contact: { email: "jane@example.com" } },
          contractor: { company_name: "Smith Plumbing" },
        },
        chase_events: [],
      };

      const { client, mockSelect, mockInsert } = createTestClient();
      mockSelect.mockResolvedValueOnce({ data: [] }); // no invoices
      mockSelect.mockResolvedValueOnce({ data: [stage] });

      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => client,
      }));

      vi.doMock("@/lib/cron-auth", () => ({
        rejectUnauthorizedCron: vi.fn(() => null),
      }));

      const { GET } = await import("@/app/api/cron/chase/route");
      const request = new Request("https://motko.app/api/cron/chase", {
        headers: { authorization: "Bearer test" },
      });

      const response = await GET(request as unknown as NextRequest);
      await response.json();

      // No chase events inserted for this stage because it has an invoice
      const stageInserts = mockInsert.mock.calls.filter((call) =>
        call[0]?.stage_id === "stage-1"
      );
      expect(stageInserts).toHaveLength(0);
    });

    it("does not chase a settled stage", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://motko.app");

      const stage = {
        id: "stage-1",
        job_id: "job-1",
        stage_number: 1,
        amount_pennies: 500000,
        due_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        invoice_id: null,
        settled_at: "2026-09-01T10:00:00Z", // settled, so excluded
        job: {
          id: "job-1",
          archived_at: null,
          quote: { status: "accepted" },
          customer: { name: "Jane Smith", contact: { email: "jane@example.com" } },
          contractor: { company_name: "Smith Plumbing" },
        },
        chase_events: [],
      };

      const { client, mockSelect, mockInsert } = createTestClient();
      mockSelect.mockResolvedValueOnce({ data: [] });
      mockSelect.mockResolvedValueOnce({ data: [stage] });

      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => client,
      }));

      vi.doMock("@/lib/cron-auth", () => ({
        rejectUnauthorizedCron: vi.fn(() => null),
      }));

      const { GET } = await import("@/app/api/cron/chase/route");
      const request = new Request("https://motko.app/api/cron/chase", {
        headers: { authorization: "Bearer test" },
      });

      const response = await GET(request as unknown as NextRequest);
      await response.json();

      const stageInserts = mockInsert.mock.calls.filter((call) =>
        call[0]?.stage_id === "stage-1"
      );
      expect(stageInserts).toHaveLength(0);
    });

    it("does not chase stages for an archived job", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://motko.app");

      const stage = {
        id: "stage-1",
        job_id: "job-1",
        stage_number: 1,
        amount_pennies: 500000,
        due_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        invoice_id: null,
        settled_at: null,
        job: {
          id: "job-1",
          archived_at: "2026-09-05T10:00:00Z", // archived
          quote: { status: "accepted" },
          customer: { name: "Jane Smith", contact: { email: "jane@example.com" } },
          contractor: { company_name: "Smith Plumbing" },
        },
        chase_events: [],
      };

      const { client, mockSelect, mockInsert } = createTestClient();
      mockSelect.mockResolvedValueOnce({ data: [] });
      mockSelect.mockResolvedValueOnce({ data: [stage] });

      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => client,
      }));

      vi.doMock("@/lib/cron-auth", () => ({
        rejectUnauthorizedCron: vi.fn(() => null),
      }));

      const { GET } = await import("@/app/api/cron/chase/route");
      const request = new Request("https://motko.app/api/cron/chase", {
        headers: { authorization: "Bearer test" },
      });

      const response = await GET(request as unknown as NextRequest);
      await response.json();

      const stageInserts = mockInsert.mock.calls.filter((call) =>
        call[0]?.stage_id === "stage-1"
      );
      expect(stageInserts).toHaveLength(0);
    });

    it("does not chase stages for a declined quote", async () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://motko.app");

      const stage = {
        id: "stage-1",
        job_id: "job-1",
        stage_number: 1,
        amount_pennies: 500000,
        due_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        invoice_id: null,
        settled_at: null,
        job: {
          id: "job-1",
          archived_at: null,
          quote: { status: "declined" },
          customer: { name: "Jane Smith", contact: { email: "jane@example.com" } },
          contractor: { company_name: "Smith Plumbing" },
        },
        chase_events: [],
      };

      const { client, mockSelect, mockInsert } = createTestClient();
      mockSelect.mockResolvedValueOnce({ data: [] });
      mockSelect.mockResolvedValueOnce({ data: [stage] });

      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => client,
      }));

      vi.doMock("@/lib/cron-auth", () => ({
        rejectUnauthorizedCron: vi.fn(() => null),
      }));

      const { GET } = await import("@/app/api/cron/chase/route");
      const request = new Request("https://motko.app/api/cron/chase", {
        headers: { authorization: "Bearer test" },
      });

      const response = await GET(request as unknown as NextRequest);
      await response.json();

      const stageInserts = mockInsert.mock.calls.filter((call) =>
        call[0]?.stage_id === "stage-1"
      );
      expect(stageInserts).toHaveLength(0);
    });
  });

  describe("Contact cap across invoices and stages", () => {
    it("applies the cap across invoice chases and stage chases together", async () => {
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://motko.app");
      vi.stubEnv("POSTMARK_API_TOKEN", "test-token");

      // Stage with 3 prior chase events
      const stage = {
        id: "stage-1",
        job_id: "job-1",
        stage_number: 1,
        amount_pennies: 500000,
        due_date: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        invoice_id: null,
        settled_at: null,
        job: {
          id: "job-1",
          archived_at: null,
          quote: { status: "accepted" },
          customer: { name: "Jane Smith", contact: { email: "jane@example.com" } },
          contractor: { company_name: "Smith Plumbing" },
        },
        chase_events: [
          { channel: "email", template_used: "day_3" },
          { channel: "email", template_used: "day_7" },
          { channel: "email", template_used: "day_14" },
        ],
      };

      const { client, mockSelect, mockInsert } = createTestClient();
      mockSelect.mockResolvedValueOnce({ data: [] });
      mockSelect.mockResolvedValueOnce({ data: [stage] });
      mockInsert.mockResolvedValueOnce({ error: null }); // cap marker claim succeeds

      vi.doMock("@/lib/supabase/admin", () => ({
        createAdminClient: () => client,
      }));

      vi.doMock("@/lib/notify-contractor", () => ({
        notifyContractorOfCustomerAction: vi.fn(async () => ({})),
      }));

      vi.doMock("@/lib/cron-auth", () => ({
        rejectUnauthorizedCron: vi.fn(() => null),
      }));

      const { GET } = await import("@/app/api/cron/chase/route");
      const request = new Request("https://motko.app/api/cron/chase", {
        headers: { authorization: "Bearer test" },
      });

      const response = await GET(request as unknown as NextRequest);
      await response.json();

      // After 3 waves, the 4th (final) should trigger, then cap
      // The cap marker should be inserted
      const capInserts = mockInsert.mock.calls.filter((call) =>
        call[0]?.channel === "cap"
      );
      expect(capInserts.length).toBeGreaterThan(0);
    });
  });
});
