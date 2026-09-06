import { describe, it, expect, vi, beforeEach } from "vitest";

// London-time overdue math (chase-plan → @/lib/overdue) stays REAL and pure;
// only I/O is mocked. state.claims models the chase_events unique index: an
// insert of an already-present (invoice, channel, template) key "conflicts".
const h = vi.hoisted(() => {
  const draftChaseMessage = vi.fn(async () => "Please pay up.");
  const notify = vi.fn(async () => {});
  const sendChaseEmail = vi.fn(async () => ({ delivered: true }));
  const sendChaseSms = vi.fn(async () => ({ delivered: true }));
  const acquireCronLock = vi.fn(async () => true);
  const releaseCronLock = vi.fn(async () => {});

  const state: { invoices: unknown[]; stages: unknown[]; claims: Set<string> } = {
    invoices: [],
    stages: [],
    claims: new Set(),
  };

  const keyOf = (id: unknown, channel: unknown, template: unknown) =>
    `${id}|${channel}|${template}`;

  const admin = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      let mode: "delete" | null = null;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (k: string, v: unknown) => {
        filters[k] = v;
        return b;
      };
      b.not = () => b;
      b.delete = () => {
        mode = "delete";
        return b;
      };
      b.insert = (row: { invoice_id?: string; stage_id?: string; channel: string; template_used: string }) => {
        if (table !== "chase_events") return Promise.resolve({ error: null });
        const id = row.invoice_id ?? row.stage_id;
        const key = keyOf(id, row.channel, row.template_used);
        if (state.claims.has(key)) return Promise.resolve({ error: { code: "23505" } });
        state.claims.add(key);
        return Promise.resolve({ error: null });
      };
      b.then = (resolve: (r: { data: unknown; error: unknown }) => unknown) => {
        if (table === "invoices") return resolve({ data: state.invoices, error: null });
        if (table === "payment_stages") return resolve({ data: state.stages, error: null });
        if (table === "chase_events" && mode === "delete") {
          const id = filters.invoice_id ?? filters.stage_id;
          state.claims.delete(keyOf(id, filters.channel, filters.template_used));
        }
        return resolve({ data: null, error: null });
      };
      return b;
    },
  };

  return { draftChaseMessage, notify, sendChaseEmail, sendChaseSms, acquireCronLock, releaseCronLock, state, admin };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.admin }));
vi.mock("@/lib/chase", () => ({ draftChaseMessage: h.draftChaseMessage }));
vi.mock("@/lib/notify-contractor", () => ({ notifyContractorOfCustomerAction: h.notify }));
vi.mock("@/lib/email", () => ({ sendChaseEmail: h.sendChaseEmail }));
vi.mock("@/lib/sms", () => ({ sendChaseSms: h.sendChaseSms }));
vi.mock("@/lib/cron-lock", () => ({
  acquireCronLock: h.acquireCronLock,
  releaseCronLock: h.releaseCronLock,
}));
vi.mock("@/lib/cron-auth", () => ({ rejectUnauthorizedCron: () => null }));

import { GET } from "./route";

const req = {} as unknown as Parameters<typeof GET>[0];

// A due date comfortably past every wave so planChase always wants to send.
const OLD_DUE = "2020-01-01";

const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-1",
  amount: 100,
  due_date: OLD_DUE,
  quote: {
    status: "accepted",
    job: {
      id: "job-1",
      customer: { name: "Dave", contact: { email: "dave@example.com" } },
      contractor: { company_name: "Acme" },
    },
  },
  chase_events: [],
  ...overrides,
});

const stage = (overrides: Record<string, unknown> = {}) => ({
  id: "stage-1",
  job_id: "job-1",
  stage_number: 1,
  amount_pennies: 50000,
  due_date: OLD_DUE,
  invoice_id: null,
  settled_at: null,
  job: {
    id: "job-1",
    archived_at: null,
    quote: { status: "accepted" },
    customer: { name: "Dave", contact: { email: "dave@example.com" } },
    contractor: { company_name: "Acme" },
  },
  chase_events: [],
  ...overrides,
});

beforeEach(() => {
  h.draftChaseMessage.mockClear();
  h.notify.mockClear();
  h.sendChaseEmail.mockClear();
  h.sendChaseEmail.mockImplementation(async () => ({ delivered: true }));
  h.sendChaseSms.mockClear();
  h.acquireCronLock.mockClear();
  h.acquireCronLock.mockImplementation(async () => true);
  h.releaseCronLock.mockClear();
  h.state.invoices = [];
  h.state.stages = [];
  h.state.claims = new Set();
});

describe("chase cron — parent-status filter (M8/#7)", () => {
  it("never chases an invoice whose parent quote is archived", async () => {
    h.state.invoices = [invoice({ quote: { status: "archived", job: invoice().quote.job } })];
    const res = await GET(req);
    expect(await res.json()).toMatchObject({ sent: 0 });
    expect(h.sendChaseEmail).not.toHaveBeenCalled();
  });

  it("never chases an invoice whose parent quote is declined", async () => {
    h.state.invoices = [invoice({ quote: { status: "declined", job: invoice().quote.job } })];
    await GET(req);
    expect(h.sendChaseEmail).not.toHaveBeenCalled();
  });

  it("never chases an orphaned invoice with no job", async () => {
    h.state.invoices = [invoice({ quote: { status: "accepted", job: null } })];
    await GET(req);
    expect(h.sendChaseEmail).not.toHaveBeenCalled();
  });
});

describe("chase cron — idempotency (M7/#9)", () => {
  it("sends a wave exactly once across two overlapping runs (claim-before-send)", async () => {
    h.state.invoices = [invoice()];
    await GET(req);
    // Second run reads the same rows; the claim insert conflicts, so no re-send.
    await GET(req);
    expect(h.sendChaseEmail).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when delivery fails so a later run retries", async () => {
    h.state.invoices = [invoice()];
    h.sendChaseEmail.mockImplementationOnce(async () => ({ delivered: false }));
    await GET(req);
    expect(h.sendChaseEmail).toHaveBeenCalledTimes(1);
    // The failed claim was rolled back, so the next run re-attempts and succeeds.
    await GET(req);
    expect(h.sendChaseEmail).toHaveBeenCalledTimes(2);
  });

  it("no-ops when the run lock is held by an overlapping run", async () => {
    h.acquireCronLock.mockImplementationOnce(async () => false);
    h.state.invoices = [invoice()];
    const res = await GET(req);
    expect(await res.json()).toMatchObject({ skipped: "locked" });
    expect(h.sendChaseEmail).not.toHaveBeenCalled();
  });
});

describe("chase cron — cap (unchanged behaviour, now idempotent)", () => {
  const fourWaves = [
    { channel: "email", template_used: "day_3" },
    { channel: "email", template_used: "day_7" },
    { channel: "email", template_used: "day_14" },
    { channel: "email", template_used: "final" },
  ];

  it("records the cap and notifies the trade once, never the customer", async () => {
    h.state.invoices = [invoice({ chase_events: fourWaves })];
    const res = await GET(req);
    expect(await res.json()).toMatchObject({ capped: 1, sent: 0 });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.sendChaseEmail).not.toHaveBeenCalled();
  });

  it("does not re-notify on a second run once the cap marker is claimed", async () => {
    h.state.invoices = [invoice({ chase_events: fourWaves })];
    await GET(req);
    await GET(req);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
});

describe("chase cron — stage chasing (STAGE-3/#640)", () => {
  it("chases an unsettled stage with a due date and no invoice", async () => {
    h.state.stages = [stage()];
    const res = await GET(req);
    expect(await res.json()).toMatchObject({ sent: 1 });
    expect(h.sendChaseEmail).toHaveBeenCalledTimes(1);
    expect(h.draftChaseMessage).toHaveBeenCalledWith(
      expect.objectContaining({ itemType: "payment" })
    );
  });

  it("never chases a stage that already has an invoice", async () => {
    h.state.stages = [stage({ invoice_id: "inv-123" })];
    await GET(req);
    expect(h.sendChaseEmail).not.toHaveBeenCalled();
  });

  it("never chases a settled stage", async () => {
    h.state.stages = [stage({ settled_at: "2026-01-01T00:00:00Z" })];
    await GET(req);
    expect(h.sendChaseEmail).not.toHaveBeenCalled();
  });

  it("never chases a stage whose job is archived", async () => {
    h.state.stages = [stage({ job: { ...stage().job, archived_at: "2026-01-01T00:00:00Z" } })];
    await GET(req);
    expect(h.sendChaseEmail).not.toHaveBeenCalled();
  });

  it("never chases a stage whose quote is declined", async () => {
    h.state.stages = [stage({ job: { ...stage().job, quote: { status: "declined" } } })];
    await GET(req);
    expect(h.sendChaseEmail).not.toHaveBeenCalled();
  });

  it("counts the cap across both invoices and stages for the same job", async () => {
    const threeWaves = [
      { channel: "email", template_used: "day_3" },
      { channel: "email", template_used: "day_7" },
      { channel: "email", template_used: "day_14" },
    ];
    h.state.invoices = [invoice({ chase_events: threeWaves })];
    h.state.stages = [stage()];
    const res = await GET(req);
    // Stage sends 1 wave, bringing the total to 4 (3 from invoice + 1 from stage)
    // This should trigger the cap
    expect(await res.json()).toMatchObject({ sent: 1, capped: 1 });
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("does not chase a stage when the cap is already reached via invoice", async () => {
    const fourWaves = [
      { channel: "email", template_used: "day_3" },
      { channel: "email", template_used: "day_7" },
      { channel: "email", template_used: "day_14" },
      { channel: "email", template_used: "final" },
    ];
    h.state.invoices = [invoice({ chase_events: fourWaves })];
    h.state.stages = [stage()];
    const res = await GET(req);
    // Cap already reached via invoice, so stage doesn't send
    expect(await res.json()).toMatchObject({ capped: 1, sent: 0 });
    expect(h.sendChaseEmail).not.toHaveBeenCalled();
  });
});
