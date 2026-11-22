import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type {
  LlmClient,
  LlmRequest,
  LlmResponse,
  PaActions,
  PaContractor,
  ToolContext,
} from "@/lib/pa/types";
import type { LineItem } from "@/lib/schemas/job";
import { createFakeDb, type FakeDb } from "./pa-fake-db";

export const NOW = new Date("2026-11-22T10:00:00.000Z");

export const labourLine = (overrides: Partial<LineItem> = {}): LineItem => ({
  description: "Kitchen rewire, labour",
  category: "labour",
  quantity: 3,
  unit: "day",
  unit_price: 300,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...overrides,
});

export const materialsLine = (overrides: Partial<LineItem> = {}): LineItem => ({
  description: "Cable and fittings",
  category: "materials",
  quantity: 1,
  unit: "lot",
  unit_price: 120,
  multiplier: 1,
  people_count: 1,
  overtime: false,
  assumed: false,
  ...overrides,
});

export type Seeded = {
  contractor: PaContractor;
  jobId: string;
  quoteId: string;
  customerId: string;
  threadId: string;
};

type SeedOptions = {
  contractorId?: string;
  quoteStatus?: string;
  lines?: LineItem[];
  sow?: Record<string, unknown> | null;
  customer?: { name: string; contact: Record<string, unknown> } | null;
  assumptions?: "none" | "unconfirmed" | "confirmed";
  vat?: boolean;
};

// One contractor with one job, a draft quote, a customer and a thread.
export const seedContractor = (db: FakeDb, options: SeedOptions = {}): Seeded => {
  const contractorId = options.contractorId ?? randomUUID();
  const jobId = randomUUID();
  const quoteId = randomUUID();
  const customerId = randomUUID();
  const threadId = randomUUID();
  const vat = options.vat ?? false;

  (db.tables.contractors ??= []).push({
    id: contractorId,
    company_name: "Sparks Ltd",
    vat_registered: vat,
  });
  const customer =
    options.customer === undefined
      ? { name: "Dave Carter", contact: { email: "dave@example.com" } }
      : options.customer;
  if (customer) {
    (db.tables.customers ??= []).push({
      id: customerId,
      contractor_id: contractorId,
      name: customer.name,
      contact: customer.contact,
    });
  }
  (db.tables.jobs ??= []).push({
    id: jobId,
    contractor_id: contractorId,
    status: "drafted",
    sow_json: options.sow === undefined ? null : options.sow,
    extracted_json: { job_type: "rewire" },
    customer_id: customer ? customerId : null,
    work_completed_at: null,
    archived_at: null,
    created_at: "2026-11-22T09:00:00.000Z",
  });
  (db.tables.quotes ??= []).push({
    id: quoteId,
    job_id: jobId,
    status: options.quoteStatus ?? "draft",
    line_items_json: options.lines ?? [labourLine(), materialsLine()],
    total: 0,
    deposit_pennies: null,
    sent_at: null,
    viewed_at: null,
    accepted_at: null,
    declined_at: null,
  });
  (db.tables.pa_threads ??= []).push({
    id: threadId,
    contractor_id: contractorId,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  });

  const mode = options.assumptions ?? "confirmed";
  if (mode !== "none") {
    const stamp = mode === "confirmed" ? NOW.toISOString() : null;
    (db.tables.pa_draft_assumptions ??= []).push({
      job_id: jobId,
      contractor_id: contractorId,
      pricing_confirmed_at: stamp,
      crew_confirmed_at: stamp,
      materials_confirmed_at: stamp,
    });
  }

  return {
    contractor: { id: contractorId, company_name: "Sparks Ltd", vat_registered: vat },
    jobId,
    quoteId,
    customerId,
    threadId,
  };
};

// A SoW in which all three slots hold a value.
export const answeredSow = {
  job_type: "rewire",
  pricing: { mode: "calculated", fixed_amount: null },
  labour_plan: { people_count: 1, duration_days: 3 },
  materials_supply: { contractor_supplied: ["cable"], customer_supplied: [], responsibility: "contractor" },
};

export const fakeActions = () => {
  const actions = {
    createManualJob: vi.fn(async () => ({ jobId: randomUUID() })),
    saveSowDelta: vi.fn(async (_input?: { jobId: string; delta: unknown }) => ({})),
    redraftJob: vi.fn(async (_input?: { jobId: string }) => ({ lineItemCount: 2 })),
    updateQuoteLineItems: vi.fn(async (_input?: unknown) => ({})),
    setQuotePricingMode: vi.fn(async (_input?: unknown) => ({})),
    sendQuote: vi.fn(async (_input?: unknown) => ({
      delivered: true,
      quoteUrl: "https://app.example/q/1",
    })),
    createInvoice: vi.fn(async (_input?: unknown) => ({})),
    markInvoicePaid: vi.fn(
      async (_input?: unknown): Promise<{ ok: true } | { error: string }> => ({ ok: true }),
    ),
    deleteDraftJob: vi.fn(async (_input?: unknown) => undefined),
    getMoneyPosition: vi.fn(async () => ({
      owedToYou: [{ customerName: "Dave Carter", totalOwed: 45000 }],
      whatsLeft: 100000,
      safeToSpend: { total: 80000, collected: 120000 },
      projection: { total: 125000, owedNet: 45000 },
    })),
  };
  return actions as typeof actions & PaActions;
};

export type FakeActions = ReturnType<typeof fakeActions>;

// A scripted LLM: each call to complete() returns the next scripted response,
// and records the request so a test can inspect what the model was shown.
export const scriptedLlm = (
  script: (LlmResponse | ((request: LlmRequest) => LlmResponse))[],
) => {
  const requests: LlmRequest[] = [];
  let index = 0;
  const client: LlmClient = {
    complete: async (request) => {
      requests.push(request);
      const next = script[Math.min(index, script.length - 1)];
      index += 1;
      if (!next) throw new Error("scriptedLlm: empty script");
      return typeof next === "function" ? next(request) : next;
    },
  };
  return { client, requests, calls: () => index };
};

export const text = (value: string): LlmResponse => ({
  content: [{ type: "text", text: value }],
  stopReason: "end_turn",
});

export const toolUse = (name: string, input: unknown, id: string = randomUUID()): LlmResponse => ({
  content: [{ type: "tool_use", id, name, input }],
  stopReason: "tool_use",
});

export const toolContext = (
  db: FakeDb,
  seeded: Seeded,
  llm: LlmClient,
  actions: PaActions,
): ToolContext => ({
  db: db.client,
  contractor: seeded.contractor,
  threadId: seeded.threadId,
  llm,
  actions,
  now: () => NOW,
});

export { createFakeDb };
