import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PA_TOOLS } from "@/lib/pa/tools";
import { buildQuoteCard } from "@/lib/pa/quote-card";
import { loadJobBundle } from "@/lib/pa/data";
import { loadNeedsAttention } from "@/lib/pa/needs-attention";
import { computeQuoteTotals, lineItemTotal } from "@/lib/quote-math";
import type { LineItem } from "@/lib/schemas/job";
import type { QuoteCard, ToolContext } from "@/lib/pa/types";
import {
  NOW,
  answeredSow,
  createFakeDb,
  fakeActions,
  labourLine,
  materialsLine,
  scriptedLlm,
  seedContractor,
  text,
  toolContext,
  toolUse,
  type FakeActions,
} from "../helpers/pa-scenario";
import type { FakeDb } from "../helpers/pa-fake-db";

const tool = (name: string) => {
  const found = PA_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

const quoteCardOf = (cards: unknown[] | undefined): QuoteCard => {
  const card = cards?.[0] as QuoteCard | undefined;
  if (!card || card.type !== "quote") throw new Error("expected a quote card");
  return card;
};

// A fake actions set whose edits really land in the fake database, so the card
// a tool returns reflects what the (real) action would have stored.
const writingActions = (db: FakeDb): FakeActions => {
  const actions = fakeActions();
  actions.updateQuoteLineItems.mockImplementation(async (input?: unknown) => {
    const { quoteId, lineItems } = input as { quoteId: string; lineItems: LineItem[] };
    const quote = db.tables.quotes!.find((row) => row.id === quoteId)!;
    quote.line_items_json = lineItems;
    return {};
  });
  return actions;
};

describe("create_quote_draft", () => {
  it("extracts a scope delta through the injected LLM, drafts through the existing path, and leaves all three assumptions unconfirmed", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { assumptions: "none" });
    const newJobId = randomUUID();
    const actions = fakeActions();
    const order: string[] = [];
    actions.createManualJob.mockImplementation(async () => {
      order.push("createManualJob");
      db.tables.jobs!.push({
        id: newJobId,
        contractor_id: seeded.contractor.id,
        status: "drafted",
        sow_json: null,
        extracted_json: null,
        customer_id: null,
        work_completed_at: null,
        archived_at: null,
        created_at: NOW.toISOString(),
      });
      db.tables.quotes!.push({
        id: randomUUID(),
        job_id: newJobId,
        status: "draft",
        line_items_json: [],
        total: 0,
        deposit_pennies: null,
        sent_at: null,
        viewed_at: null,
        accepted_at: null,
        declined_at: null,
      });
      return { jobId: newJobId };
    });
    actions.saveSowDelta.mockImplementation(async () => {
      order.push("saveSowDelta");
      return {};
    });
    actions.redraftJob.mockImplementation(async () => {
      order.push("redraftJob");
      db.tables.quotes!.find((row) => row.job_id === newJobId)!.line_items_json = [
        labourLine(),
        materialsLine(),
      ];
      return { lineItemCount: 2 };
    });

    const llm = scriptedLlm([
      toolUse("update_sow", {
        job_type: "rewire",
        complete: true,
        next_question: "How long?",
        rooms: [{ name: "Kitchen", work_items: ["Full rewire"] }],
      }),
    ]);
    const description = "Quote Dave, 3 days rewiring the kitchen";
    const output = await tool("create_quote_draft").run(
      { description, customer_name: "Dave Carter", customer_email: "dave@example.com" },
      toolContext(db, seeded, llm.client, actions),
    );

    // The extraction call: forced tool, the contractor's words only.
    expect(llm.requests[0]!.forceTool).toBe("update_sow");
    expect(llm.requests[0]!.messages).toEqual([{ role: "user", content: description }]);
    expect(llm.requests[0]!.system).toMatch(/Never infer or invent/);

    // The existing pipeline, in order, with flow-control fields stripped.
    expect(order).toEqual(["createManualJob", "saveSowDelta", "redraftJob"]);
    const delta = actions.saveSowDelta.mock.calls[0]![0]!.delta as Record<string, unknown>;
    expect(delta).toMatchObject({ job_type: "rewire", customer_name: "Dave Carter" });
    expect(delta).not.toHaveProperty("complete");
    expect(delta).not.toHaveProperty("next_question");

    // What was said is stored for the drafter, and the customer is persisted.
    expect(db.tables.jobs!.find((job) => job.id === newJobId)!.transcript).toBe(description);
    expect(db.tables.customers!.some((c) => c.name === "Dave Carter" && c.contractor_id === seeded.contractor.id)).toBe(true);

    // Nothing was sent, and nothing is confirmed.
    expect(actions.sendQuote).not.toHaveBeenCalled();
    const record = db.tables.pa_draft_assumptions!.find((row) => row.job_id === newJobId)!;
    expect(record).toMatchObject({
      contractor_id: seeded.contractor.id,
      pricing_confirmed_at: null,
      crew_confirmed_at: null,
      materials_confirmed_at: null,
    });
    const card = quoteCardOf(output.cards);
    expect(card.assumptions.map((a) => a.slot)).toEqual(["pricing_mode", "crew", "materials_supply"]);
    expect(card.assumptions.every((a) => !a.confirmed)).toBe(true);
    expect(card.canSend).toBe(false);
  });

  it("refuses cleanly when the model returns no scope", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db);
    const actions = fakeActions();
    const llm = scriptedLlm([text("I can't tell")]);
    await expect(
      tool("create_quote_draft").run(
        { description: "uh, the thing" },
        toolContext(db, seeded, llm.client, actions),
      ),
    ).rejects.toThrow(/couldn't pick the job out/);
    expect(actions.createManualJob).not.toHaveBeenCalled();
  });
});

describe("money on the card comes from quote-math", () => {
  it("equals computeQuoteTotals and lineItemTotal for the same lines, with and without VAT", async () => {
    for (const vat of [false, true]) {
      const db = createFakeDb();
      const lines = [
        labourLine({ quantity: 2.5, unit_price: 333.33, multiplier: 1.5 }),
        materialsLine({ unit_price: 17.19, quantity: 7 }),
      ];
      const seeded = seedContractor(db, { lines, vat, sow: answeredSow });
      const bundle = (await loadJobBundle(db.client, seeded.contractor.id, seeded.jobId))!;
      const card = buildQuoteCard(bundle, vat, null)!;
      const totals = computeQuoteTotals(lines, vat);
      expect(card.total).toBe(totals.total);
      expect(card.subtotal).toBe(totals.subtotal);
      expect(card.vat).toBe(totals.vat);
      expect(card.lines.map((line) => line.amount)).toEqual(lines.map(lineItemTotal));
    }
  });

  it("ignores any figure the model smuggles into update_quote", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow });
    const actions = writingActions(db);
    const llm = scriptedLlm([text("x")]);
    const output = await tool("update_quote").run(
      {
        jobId: seeded.jobId,
        total: 1,
        changes: [
          {
            op: "add_line",
            description: "Skip hire",
            category: "other",
            quantity: 1,
            unit: "skip",
            unit_price: 180,
            total: 99999,
            amount: 99999,
          },
        ],
      },
      toolContext(db, seeded, llm.client, actions),
    );
    const sent = actions.updateQuoteLineItems.mock.calls[0]![0] as { lineItems: LineItem[] };
    const added = sent.lineItems[sent.lineItems.length - 1]!;
    expect(added).toMatchObject({ description: "Skip hire", unit_price: 180, edited: true });
    expect(added).not.toHaveProperty("total");
    const card = quoteCardOf(output.cards);
    expect(card.total).toBe(computeQuoteTotals(sent.lineItems, false).total);
    expect(card.total).toBe(300 * 3 + 120 + 180);
  });
});

describe("update_quote", () => {
  it("sets a stated fixed price through setQuotePricingMode, and the pricing assumption must be re-confirmed", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
    const actions = writingActions(db);
    const llm = scriptedLlm([text("x")]);
    await tool("update_quote").run(
      { jobId: seeded.jobId, changes: [{ op: "set_fixed_price", amount: 850 }] },
      toolContext(db, seeded, llm.client, actions),
    );
    expect(actions.setQuotePricingMode).toHaveBeenCalledWith({
      jobId: seeded.jobId,
      quoteId: seeded.quoteId,
      mode: "fixed",
      fixedAmount: 850,
    });
    const record = db.tables.pa_draft_assumptions![0]!;
    expect(record.pricing_confirmed_at).toBeNull();
    expect(record.crew_confirmed_at).not.toBeNull();
  });

  it("will not edit a quote that has already gone out", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { quoteStatus: "sent", sow: answeredSow });
    const actions = writingActions(db);
    const llm = scriptedLlm([text("x")]);
    await expect(
      tool("update_quote").run(
        { jobId: seeded.jobId, changes: [{ op: "remove_line", line: 1 }] },
        toolContext(db, seeded, llm.client, actions),
      ),
    ).rejects.toThrow(/already gone out/);
    expect(actions.updateQuoteLineItems).not.toHaveBeenCalled();
  });

  it("refuses to price a crew-rate line by hand, and to add a priceless line", async () => {
    const db = createFakeDb();
    const crewLine = labourLine({ people: [{ label: "Dave", days: 3, day_rate: 300 }] });
    const seeded = seedContractor(db, { lines: [crewLine], sow: answeredSow });
    const actions = writingActions(db);
    const llm = scriptedLlm([text("x")]);
    const ctx = toolContext(db, seeded, llm.client, actions);
    await expect(
      tool("update_quote").run(
        { jobId: seeded.jobId, changes: [{ op: "set_line", line: 1, unit_price: 100 }] },
        ctx,
      ),
    ).rejects.toThrow(/day rates/);
    // unit_price is required: a model cannot add a line it has not been given a figure for.
    await expect(
      tool("update_quote").run(
        {
          jobId: seeded.jobId,
          changes: [{ op: "add_line", description: "Skip", category: "other", quantity: 1, unit: "skip" }],
        },
        ctx,
      ),
    ).rejects.toThrow();
    expect(actions.updateQuoteLineItems).not.toHaveBeenCalled();
  });

  it("will not touch another contractor's quote", async () => {
    const db = createFakeDb();
    const alice = seedContractor(db, { sow: answeredSow });
    const bob = seedContractor(db, { sow: answeredSow });
    const actions = writingActions(db);
    const llm = scriptedLlm([text("x")]);
    await expect(
      tool("update_quote").run(
        { jobId: alice.jobId, changes: [{ op: "remove_line", line: 1 }] },
        toolContext(db, bob, llm.client, actions),
      ),
    ).rejects.toThrow(/can't find/);
    expect(actions.updateQuoteLineItems).not.toHaveBeenCalled();
  });
});

describe("set_assumption records; only the contractor's tap confirms", () => {
  it("crew: updates the SoW, re-prices, and leaves the slot unconfirmed", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
    const actions = writingActions(db);
    const llm = scriptedLlm([text("x")]);
    const output = await tool("set_assumption").run(
      { slot: "crew", jobId: seeded.jobId, people_count: 2 },
      toolContext(db, seeded, llm.client, actions),
    );
    expect(actions.saveSowDelta).toHaveBeenCalledWith({
      jobId: seeded.jobId,
      delta: { labour_plan: { people_count: 2, crew_description: undefined } },
    });
    expect(actions.redraftJob).toHaveBeenCalledWith({ jobId: seeded.jobId });
    expect(db.tables.pa_draft_assumptions![0]!.crew_confirmed_at).toBeNull();
    expect((output.data as { confirmed: boolean }).confirmed).toBe(false);
  });

  it("does not re-price over lines the contractor edited by hand", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, {
      sow: answeredSow,
      lines: [labourLine({ edited: true, unit_price: 275 })],
    });
    const actions = writingActions(db);
    const llm = scriptedLlm([text("x")]);
    const output = await tool("set_assumption").run(
      { slot: "materials_supply", jobId: seeded.jobId, responsibility: "customer" },
      toolContext(db, seeded, llm.client, actions),
    );
    expect(actions.saveSowDelta).toHaveBeenCalled();
    expect(actions.redraftJob).not.toHaveBeenCalled();
    expect((output.data as { repriced: boolean }).repriced).toBe(false);
  });

  it("will not pick a fixed price for the contractor", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow });
    const actions = writingActions(db);
    const llm = scriptedLlm([text("x")]);
    await expect(
      tool("set_assumption").run(
        { slot: "pricing_mode", jobId: seeded.jobId, mode: "fixed" },
        toolContext(db, seeded, llm.client, actions),
      ),
    ).rejects.toThrow(/fixed price/);
    expect(actions.setQuotePricingMode).not.toHaveBeenCalled();
  });
});

describe("cross-contractor isolation in the read tools", () => {
  const setupTwo = () => {
    const db = createFakeDb();
    const alice = seedContractor(db, { sow: answeredSow });
    const bob = seedContractor(db, { sow: answeredSow, customer: { name: "Bob's Customer", contact: { email: "b@example.com" } } });
    return { db, alice, bob, llm: scriptedLlm([text("x")]), actions: fakeActions() };
  };

  it("get_job returns nothing for a job id that belongs to someone else", async () => {
    const { db, alice, bob, llm, actions } = setupTwo();
    await expect(
      tool("get_job").run({ jobId: alice.jobId }, toolContext(db, bob, llm.client, actions)),
    ).rejects.toThrow(/can't find/);
  });

  it("list_jobs and needs-attention only ever show the signed-in contractor's jobs", async () => {
    const { db, alice, bob, llm, actions } = setupTwo();
    const ctx: ToolContext = toolContext(db, bob, llm.client, actions);
    const listed = (await tool("list_jobs").run({}, ctx)).data as { jobs: { jobId: string }[] };
    expect(listed.jobs.map((job) => job.jobId)).toEqual([bob.jobId]);
    const needs = await loadNeedsAttention(db.client, bob.contractor, NOW.getTime());
    expect(needs.map((item) => item.jobId)).toEqual([bob.jobId]);
    expect(JSON.stringify(listed)).not.toContain(alice.jobId);
  });

  it("every contractor-owned read names contractor_id", async () => {
    const { db, bob, llm, actions } = setupTwo();
    db.queries.length = 0;
    await tool("list_jobs").run({}, toolContext(db, bob, llm.client, actions));
    const jobsQuery = db.queries.find((query) => query.table === "jobs")!;
    expect(jobsQuery.filters).toContainEqual({ op: "eq", column: "contractor_id", value: bob.contractor.id });
    const customersQuery = db.queries.find((query) => query.table === "customers")!;
    expect(customersQuery.filters).toContainEqual({ op: "eq", column: "contractor_id", value: bob.contractor.id });
  });
});

describe("get_needs_attention", () => {
  it("lists drafts and accepted-without-contract jobs, and skips jobs waiting on the customer", async () => {
    const db = createFakeDb();
    const draft = seedContractor(db, { sow: answeredSow });
    const contractorId = draft.contractor.id;
    const sent = seedContractor(db, { contractorId, quoteStatus: "sent" });
    const accepted = seedContractor(db, { contractorId, quoteStatus: "accepted" });
    const items = await loadNeedsAttention(db.client, draft.contractor, NOW.getTime());
    const ids = items.map((item) => item.jobId);
    expect(ids).toContain(draft.jobId);
    expect(ids).toContain(accepted.jobId);
    expect(ids).not.toContain(sent.jobId);
    expect(items.find((item) => item.jobId === accepted.jobId)!.situation).toBe("accepted_need_contract");
  });
});

describe("get_money_position", () => {
  it("returns pre-formatted figures from the existing position, not model arithmetic", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db);
    const llm = scriptedLlm([text("x")]);
    const output = await tool("get_money_position").run(
      {},
      toolContext(db, seeded, llm.client, fakeActions()),
    );
    expect(output.data).toMatchObject({
      safeToSpend: "£800.00",
      owedBy: [{ customer: "Dave Carter", owed: "£450.00" }],
    });
  });
});
