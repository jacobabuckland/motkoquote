import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PA_TOOLS } from "@/lib/pa/tools";
import { confirmPendingAction, proposeSendQuote, type GateContext } from "@/lib/pa/pending";
import { buildQuoteCard, sendReadiness } from "@/lib/pa/quote-card";
import { loadAssumptionRecord } from "@/lib/pa/assumptions";
import { loadJobBundle } from "@/lib/pa/data";
import { cleanEmail, describeActionError, isValidEmail } from "@/lib/pa/customer-details";
import { NEXT_STEP } from "@/lib/pa/needs-attention";
import { buildSystemPrompt } from "@/lib/pa/prompt";
import { customerInputSchema } from "@/lib/schemas/customer";
import type { QuoteCard } from "@/lib/pa/types";
import type { FakeDb } from "../helpers/pa-fake-db";
import {
  NOW,
  answeredSow,
  createFakeDb,
  fakeActions,
  scriptedLlm,
  seedContractor,
  toolContext,
  type Seeded,
} from "../helpers/pa-scenario";

const gateFor = (db: FakeDb, seeded: Seeded, actions = fakeActions()): GateContext => ({
  db: db.client,
  contractor: seeded.contractor,
  threadId: seeded.threadId,
  actions,
  now: () => NOW,
});

const tool = (name: string) => {
  const found = PA_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

// The exact thing that reached a contractor: a real ZodError from the real
// customer schema, rejecting the email.
const realEmailZodError = () => {
  const result = customerInputSchema.safeParse({ name: "Dave", email: "dave@example.com." });
  if (result.success) throw new Error("expected the real schema to reject that address");
  return result.error;
};

const NOT_A_WALL_OF_JSON = /[{}[\]"]/;

describe("cleanEmail: an address as a person meant it", () => {
  it.each([
    ["dave@example.com", "dave@example.com"],
    ["  dave@example.com. ", "dave@example.com"],
    ["dave @example.com", "dave@example.com"],
    ["dave@ example.com", "dave@example.com"],
    ["<dave@example.com>", "dave@example.com"],
    ["mailto:dave@example.com", "dave@example.com"],
    ["Dave@Example.com,", "Dave@Example.com"],
    ["dave@example.com!?", "dave@example.com"],
  ])("%j becomes %j", (raw, expected) => {
    expect(cleanEmail(raw)).toBe(expected);
    expect(isValidEmail(cleanEmail(raw))).toBe(true);
  });

  it("returns nothing for nothing", () => {
    expect(cleanEmail("")).toBeUndefined();
    expect(cleanEmail("   ")).toBeUndefined();
    expect(cleanEmail(null)).toBeUndefined();
    expect(cleanEmail(undefined)).toBeUndefined();
  });

  it("never repairs an address that is actually wrong", () => {
    for (const raw of ["not an email", "dave@@example.com", "dave@example", "@example.com"]) {
      expect(isValidEmail(cleanEmail(raw)), raw).toBe(false);
    }
  });

  it("agrees with the rule the real send applies, so the card and the send can't disagree", () => {
    for (const candidate of ["dave@example.com", "a.b+c@mail.co.uk", "dave@example", "dave@", "x@y.z", "dave@example.com."]) {
      const real = customerInputSchema.safeParse({ name: "D", email: candidate }).success;
      expect(isValidEmail(candidate), candidate).toBe(real);
    }
  });
});

describe("describeActionError: one plain sentence, never a dump", () => {
  it("names the field for a real validation error", () => {
    expect(describeActionError(realEmailZodError())).toMatch(/email address doesn't look right/);
  });

  it("recognises a validation error that has turned into a string of JSON", () => {
    const stringified = new Error(JSON.stringify(realEmailZodError().issues, null, 2));
    expect(describeActionError(stringified)).toMatch(/email address doesn't look right/);
  });

  it("names a phone or name problem too", () => {
    const phone = new Error(JSON.stringify([{ code: "invalid_format", path: ["customer", "phone"] }]));
    const name = new Error(JSON.stringify([{ code: "too_small", path: ["customer", "name"] }]));
    expect(describeActionError(phone)).toMatch(/mobile number/);
    expect(describeActionError(name)).toMatch(/customer's name/);
  });

  it("keeps a short human-written message", () => {
    expect(describeActionError(new Error("The customer hasn't accepted this quote"))).toBe(
      "The customer hasn't accepted this quote.",
    );
  });

  it("replaces anything machine-made with a generic line", () => {
    const machine = [
      new Error("TypeError: Cannot read properties of null (reading 'id')"),
      new Error(`{"code":"23505","message":"duplicate key value violates unique constraint"}`),
      new Error("x".repeat(400)),
      "a bare string",
      undefined,
    ];
    for (const error of machine) {
      expect(describeActionError(error)).toBe("Something went wrong on our side.");
    }
  });

  it("never returns JSON, brackets, quotes or a long string, whatever it is given", () => {
    const inputs: unknown[] = [
      realEmailZodError(),
      new Error(JSON.stringify(realEmailZodError().issues)),
      new Error("[ { oops } ]"),
      new Error("y".repeat(900)),
    ];
    for (const error of inputs) {
      const sentence = describeActionError(error);
      expect(sentence).not.toMatch(NOT_A_WALL_OF_JSON);
      expect(sentence.length).toBeLessThan(160);
    }
  });
});

describe("a stored address that was typed or dictated badly", () => {
  const seedWithEmail = (email: string | undefined, extra: Record<string, unknown> = {}) => {
    const db = createFakeDb();
    const seeded = seedContractor(db, {
      sow: answeredSow,
      assumptions: "confirmed",
      customer: { name: "Dave Carter", contact: { ...(email === undefined ? {} : { email }), ...extra } },
    });
    return { db, seeded };
  };

  const readinessOf = async (db: FakeDb, seeded: Seeded) => {
    const bundle = (await loadJobBundle(db.client, seeded.contractor.id, seeded.jobId))!;
    const record = await loadAssumptionRecord(db.client, seeded.contractor.id, seeded.jobId);
    return sendReadiness(bundle, false, record);
  };

  it("is cleaned, so the send the contractor asked for goes to the address they meant", async () => {
    const { db, seeded } = seedWithEmail("dave @example.com.");
    const readiness = await readinessOf(db, seeded);
    expect(readiness.blockers).toEqual([]);
    expect(readiness.customer?.email).toBe("dave@example.com");

    // And all the way through: the real send is handed the cleaned address.
    const actions = fakeActions();
    const gate = gateFor(db, seeded, actions);
    const card = await proposeSendQuote(gate, seeded.jobId);
    expect(card.summary).toContain("dave@example.com");
    expect(card.summary).not.toContain("dave @");
    const result = await confirmPendingAction(gate, card.pendingActionId);
    expect(result.ok).toBe(true);
    expect(actions.sendQuote).toHaveBeenCalledTimes(1);
    const handedToSend = actions.sendQuote.mock.calls[0]![0] as { customer: { email?: string } };
    expect(handedToSend.customer.email).toBe("dave@example.com");
  });

  it("blocks the card with a sentence when it is genuinely wrong, before Send is offered", async () => {
    const { db, seeded } = seedWithEmail("dave-at-example");
    const readiness = await readinessOf(db, seeded);
    expect(readiness.customer).toBeNull();
    expect(readiness.blockers).toHaveLength(1);
    expect(readiness.blockers[0]).toMatch(/doesn't look right\. Tell me the right one/);
    expect(readiness.blockers[0]).toContain("dave-at-example");

    const bundle = (await loadJobBundle(db.client, seeded.contractor.id, seeded.jobId))!;
    const card = buildQuoteCard(bundle, false, null, NOW.getTime())!;
    expect(card.canSend).toBe(false);

    await expect(proposeSendQuote(gateFor(db, seeded), seeded.jobId)).rejects.toThrow(/doesn't look right/);
    expect(db.tables.pa_pending_actions ?? []).toHaveLength(0);
  });

  it("a phone-only customer is still fine, but a bad email next to a phone is still a block", async () => {
    const phoneOnly = seedWithEmail(undefined, { phone: "07700900123" });
    expect((await readinessOf(phoneOnly.db, phoneOnly.seeded)).blockers).toEqual([]);

    const both = seedWithEmail("nonsense", { phone: "07700900123" });
    expect((await readinessOf(both.db, both.seeded)).blockers[0]).toMatch(/doesn't look right/);
  });
});

describe("the confirm tap never shows raw error text", () => {
  const readySend = async (sendQuoteError: unknown) => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
    const actions = fakeActions();
    actions.sendQuote.mockRejectedValue(sendQuoteError);
    const gate = gateFor(db, seeded, actions);
    const card = await proposeSendQuote(gate, seeded.jobId);
    return { db, gate, card };
  };

  it("turns the real validation failure into a sentence, shown the same on a second tap", async () => {
    const { db, gate, card } = await readySend(realEmailZodError());
    const first = await confirmPendingAction(gate, card.pendingActionId);
    expect(first.ok).toBe(false);
    const message = first.ok === false ? first.message : "";
    expect(message).toMatch(/email address doesn't look right/);
    expect(message).not.toMatch(NOT_A_WALL_OF_JSON);
    expect(message).not.toMatch(/invalid_format|origin|pattern/);
    expect(message.length).toBeLessThan(200);

    // What was stored, and so what a reloaded card shows, is the same sentence.
    const stored = String(db.tables.pa_pending_actions![0]!.outcome_message);
    expect(stored).toBe(message);

    const second = await confirmPendingAction(gate, card.pendingActionId);
    expect(second.ok === false && second.message).toBe(message);
  });

  it("says what kind of thing failed for a dump it can read, and gives a generic line for one it can't", async () => {
    // Readable: a list of validation issues, none of them about a known field.
    const readable = await readySend(new Error(`[ { "code": "x", "path": ["a"] } ]`));
    const first = await confirmPendingAction(readable.gate, readable.card.pendingActionId);
    const readableMessage = first.ok === false ? first.message : "";
    expect(readableMessage).toContain("Some of the details didn't pass the checks.");
    expect(readableMessage).not.toMatch(NOT_A_WALL_OF_JSON);

    // Unreadable: cut off mid-way, so there is nothing safe to say about it.
    const cutOff = await readySend(new Error(`[ { "code": "x", "path": ["a"`));
    const second = await confirmPendingAction(cutOff.gate, cutOff.card.pendingActionId);
    const cutOffMessage = second.ok === false ? second.message : "";
    expect(cutOffMessage).toContain("Something went wrong on our side.");
    expect(cutOffMessage).not.toMatch(NOT_A_WALL_OF_JSON);
  });
});

describe("fixing the customer from chat", () => {
  const draftToEdit = () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
    const ctx = toolContext(db, seeded, scriptedLlm([]).client, fakeActions());
    return { db, seeded, ctx };
  };

  it("cleans a new address before storing it", async () => {
    const { db, seeded, ctx } = draftToEdit();
    await tool("update_quote").run(
      { jobId: seeded.jobId, changes: [{ op: "set_customer", email: "dave @example.com." }] },
      ctx,
    );
    expect((db.tables.customers![0]!.contact as { email: string }).email).toBe("dave@example.com");
  });

  it("refuses one that can't send, in words, and changes nothing", async () => {
    const { db, seeded, ctx } = draftToEdit();
    await expect(
      tool("update_quote").run(
        { jobId: seeded.jobId, changes: [{ op: "set_customer", email: "dave-at-example" }] },
        ctx,
      ),
    ).rejects.toThrow(/doesn't look right\. Say it again/);
    expect((db.tables.customers![0]!.contact as { email: string }).email).toBe("dave@example.com");
  });
});

describe("what happens next", () => {
  it("has a plain sentence for every situation, none of them empty", () => {
    const steps = Object.values(NEXT_STEP);
    expect(steps).toHaveLength(12);
    for (const step of steps) expect(step.trim().length).toBeGreaterThan(10);
  });

  it("is on a draft's card and in what get_job tells the model", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
    const ctx = toolContext(db, seeded, scriptedLlm([]).client, fakeActions());
    const output = await tool("get_job").run({ jobId: seeded.jobId }, ctx);
    expect((output.data as { nextStep: string }).nextStep).toBe(NEXT_STEP.draft_quote);
    expect((output.cards![0] as QuoteCard).nextStep).toBe(NEXT_STEP.draft_quote);
  });

  it("tells an accepted job that the contract comes before the invoice, and where to send it", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed", quoteStatus: "accepted" });
    const ctx = toolContext(db, seeded, scriptedLlm([]).client, fakeActions());
    const output = await tool("get_job").run({ jobId: seeded.jobId }, ctx);
    const next = (output.data as { nextStep: string }).nextStep;
    expect(next).toBe(NEXT_STEP.accepted_need_contract);
    expect(next).toMatch(/contract/);
    expect(next).toMatch(/job page/);
    expect(next).toMatch(/invoice comes after/);
  });

  it("is in the assistant's standing instructions, with the errors rule", () => {
    const prompt = buildSystemPrompt({ companyName: "Sparks Ltd", today: "22 Nov 2026" });
    expect(prompt).toMatch(/quote sent, customer accepts, contract sent and signed, deposit invoice/);
    expect(prompt).toMatch(/call show_progress for that job[\s\S]*answer from its nextStep/);
    expect(prompt).toMatch(/Never repeat raw error text, JSON, codes or field names/);
    expect(prompt).toMatch(/set_customer/);
  });
});

describe("drafting a quote from a dictated email", () => {
  it("stores the cleaned address and hands the cleaned address to the drafter", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { assumptions: "none" });
    const newJobId = randomUUID();
    const actions = fakeActions();
    actions.createManualJob.mockImplementation(async () => {
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
    actions.redraftJob.mockResolvedValue({ lineItemCount: 0 });
    const { toolUse } = await import("../helpers/pa-scenario");
    const llm = scriptedLlm([
      toolUse("update_sow", { job_type: "rewire", complete: true, next_question: "?", rooms: [] }),
    ]);

    await tool("create_quote_draft").run(
      { description: "Quote Dave for a rewire", customer_name: "Dave Carter", customer_email: "dave @example.com." },
      toolContext(db, seeded, llm.client, actions),
    );

    const delta = actions.saveSowDelta.mock.calls[0]![0]!.delta as Record<string, unknown>;
    expect(delta.customer_email).toBe("dave@example.com");
    const stored = db.tables.customers!.find((row) => row.name === "Dave Carter" && row.id !== seeded.threadId);
    const emails = db.tables.customers!.map((row) => (row.contact as { email?: string }).email);
    expect(emails).toContain("dave@example.com");
    expect(stored).toBeDefined();
  });
});
