import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  confirmAssumptionFromCard,
  confirmFromCard,
  handleUserMessage,
  loadThread,
  proposeSendFromCard,
  MAX_MESSAGE_CHARS,
  type PaServiceContext,
} from "@/lib/pa/service";
import { deriveAssumptions } from "@/lib/pa/assumptions";
import { sowStateSchema } from "@/lib/schemas/sow";
import type { ConfirmCard, QuoteCard } from "@/lib/pa/types";
import {
  NOW,
  answeredSow,
  createFakeDb,
  fakeActions,
  scriptedLlm,
  seedContractor,
  text,
  toolUse,
  type Seeded,
} from "../helpers/pa-scenario";
import type { FakeDb } from "../helpers/pa-fake-db";
import type { LlmClient } from "@/lib/pa/types";

const serviceFor = (
  db: FakeDb,
  seeded: Seeded,
  llm: LlmClient,
  actions = fakeActions(),
): PaServiceContext => {
  // A clock that ticks, so messages saved in one test have distinct, ordered
  // timestamps the way they do in production.
  let tick = 0;
  return {
    db: db.client,
    contractor: seeded.contractor,
    llm,
    actions,
    now: () => new Date(NOW.getTime() + 1000 * tick++),
  };
};

const SLOTS = ["pricing_mode", "crew", "materials_supply"] as const;
const SHOWN = {
  pricing_mode: "Worked out from your rates",
  crew: "Just you",
  materials_supply: "You supply the materials",
} as const;

describe("handleUserMessage", () => {
  it("creates a thread, stores both messages and returns the reply with its cards", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "unconfirmed" });
    db.tables.pa_threads = [];
    const llm = scriptedLlm([
      toolUse("get_job", { jobId: seeded.jobId }),
      text("Dave's draft is ready to check."),
    ]);
    const result = await handleUserMessage(serviceFor(db, seeded, llm.client), {
      text: "how's Dave's quote?",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(db.tables.pa_threads).toHaveLength(1);
    expect(db.tables.pa_threads![0]!.contractor_id).toBe(seeded.contractor.id);
    expect(db.tables.pa_messages!.map((m) => m.role)).toEqual(["user", "assistant"]);
    const reply = result.messages[1]!;
    expect(reply.content).toBe("Dave's draft is ready to check.");
    expect(reply.cards[0]).toMatchObject({ type: "quote", jobId: seeded.jobId });
    expect(db.tables.pa_messages![1]!.tool_calls).toEqual([{ name: "get_job", ok: true }]);
  });

  it("sends earlier turns to the model as plain text, with job ids but no customer text", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow });
    const first = scriptedLlm([toolUse("get_job", { jobId: seeded.jobId }), text("Here it is.")]);
    await handleUserMessage(serviceFor(db, seeded, first.client), {
      threadId: seeded.threadId,
      text: "show me Dave's quote",
    });
    const second = scriptedLlm([text("ok")]);
    await handleUserMessage(serviceFor(db, seeded, second.client), {
      threadId: seeded.threadId,
      text: "send it",
    });
    const sent = JSON.stringify(second.requests[0]!.messages);
    expect(sent).toContain(`quote card for job ${seeded.jobId}`);
    expect(sent).not.toContain("Dave Carter");
    expect(second.requests[0]!.messages.at(-1)).toEqual({ role: "user", content: "send it" });
  });

  it("rejects empty and over-long messages without calling the model", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db);
    const llm = scriptedLlm([text("x")]);
    const ctx = serviceFor(db, seeded, llm.client);
    expect((await handleUserMessage(ctx, { text: "   " })).ok).toBe(false);
    expect((await handleUserMessage(ctx, { text: "x".repeat(MAX_MESSAGE_CHARS + 1) })).ok).toBe(false);
    expect(llm.calls()).toBe(0);
  });

  it("will not post into, or read, another contractor's thread", async () => {
    const db = createFakeDb();
    const alice = seedContractor(db, { sow: answeredSow });
    const bob = seedContractor(db, { sow: answeredSow });
    const llm = scriptedLlm([text("hi")]);
    const aliceCtx = serviceFor(db, alice, llm.client);
    await handleUserMessage(aliceCtx, { threadId: alice.threadId, text: "private note" });

    const bobCtx = serviceFor(db, bob, llm.client);
    const posted = await handleUserMessage(bobCtx, { threadId: alice.threadId, text: "hello" });
    expect(posted).toEqual({ ok: false, error: "I can't find that conversation." });
    expect(await loadThread(bobCtx, alice.threadId)).toEqual([]);
    expect(
      db.tables.pa_messages!.every((message) => message.contractor_id === alice.contractor.id),
    ).toBe(true);
  });

  it("a model that never stops asking for tools ends with the safe message and stores it", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db);
    const llm = scriptedLlm([toolUse("list_jobs", {})]);
    const result = await handleUserMessage(serviceFor(db, seeded, llm.client), {
      threadId: seeded.threadId,
      text: "go",
    });
    expect(result.ok && result.messages[1]!.content).toMatch(/got tangled up/);
  });
});

describe("the Send button, the confirm tap and the assumption chips", () => {
  const unconfirmedSetup = () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "unconfirmed" });
    const actions = fakeActions();
    return { db, seeded, actions, ctx: serviceFor(db, seeded, scriptedLlm([text("x")]).client, actions) };
  };

  it("a draft cannot be sent until the contractor has tapped all three, and then it takes two taps", async () => {
    const { db, seeded, actions, ctx } = unconfirmedSetup();

    // Send is refused while anything is unconfirmed.
    const early = await proposeSendFromCard(ctx, { threadId: seeded.threadId, jobId: seeded.jobId });
    expect(early.ok).toBe(false);
    expect(db.tables.pa_pending_actions ?? []).toHaveLength(0);

    for (const slot of SLOTS) {
      const tapped = await confirmAssumptionFromCard(ctx, {
        jobId: seeded.jobId,
        slot,
        expectedValue: SHOWN[slot],
      });
      expect(tapped.ok).toBe(true);
    }

    // Tap 1: Send on the card -> a confirm card, not a send.
    const proposed = await proposeSendFromCard(ctx, { threadId: seeded.threadId, jobId: seeded.jobId });
    expect(proposed.ok).toBe(true);
    expect(actions.sendQuote).not.toHaveBeenCalled();
    const confirmCard = (proposed.ok ? proposed.messages[0]!.cards[0] : null) as ConfirmCard;
    expect(confirmCard.type).toBe("confirm");

    // Tap 2: the confirm card.
    const done = await confirmFromCard(ctx, {
      threadId: seeded.threadId,
      pendingId: confirmCard.pendingActionId,
    });
    expect(done.ok).toBe(true);
    expect(actions.sendQuote).toHaveBeenCalledTimes(1);
    expect(done.ok && done.link).toBe(`/jobs/${seeded.jobId}`);
  });

  it("cannot confirm a slot that has no value, or someone else's job", async () => {
    const db = createFakeDb();
    const alice = seedContractor(db, { sow: null, assumptions: "none" });
    const bob = seedContractor(db, { sow: answeredSow, assumptions: "unconfirmed" });
    const llm = scriptedLlm([text("x")]).client;
    const empty = await confirmAssumptionFromCard(serviceFor(db, alice, llm), {
      jobId: alice.jobId,
      slot: "pricing_mode",
      expectedValue: "",
    });
    expect(empty).toEqual({ ok: false, error: "Tell me that one first and I'll put it on the draft." });

    const cross = await confirmAssumptionFromCard(serviceFor(db, alice, llm), {
      jobId: bob.jobId,
      slot: "crew",
      expectedValue: "Just you",
    });
    expect(cross.ok).toBe(false);
    expect(db.tables.pa_draft_assumptions!.find((row) => row.job_id === bob.jobId)!.crew_confirmed_at).toBeNull();
  });

  it("the model's confirm is not a thing: the only writer of confirmed_at is the tap", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "unconfirmed" });
    const llm = scriptedLlm([
      toolUse("set_assumption", { slot: "crew", jobId: seeded.jobId, people_count: 1 }),
      toolUse("set_assumption", { slot: "materials_supply", jobId: seeded.jobId, responsibility: "contractor" }),
      toolUse("set_assumption", { slot: "pricing_mode", jobId: seeded.jobId, mode: "calculated" }),
      toolUse("propose_send_quote", { jobId: seeded.jobId }),
      text("All set and confirmed."),
    ]);
    const actions = fakeActions();
    const result = await handleUserMessage(serviceFor(db, seeded, llm.client, actions), {
      threadId: seeded.threadId,
      text: "just get it out the door",
    });
    expect(result.ok).toBe(true);
    const record = db.tables.pa_draft_assumptions![0]!;
    expect(record.pricing_confirmed_at).toBeNull();
    expect(record.crew_confirmed_at).toBeNull();
    expect(record.materials_confirmed_at).toBeNull();
    expect(db.tables.pa_pending_actions ?? []).toHaveLength(0);
    expect(actions.sendQuote).not.toHaveBeenCalled();
  });

  it("a reloaded thread shows live cards: confirmed chips, and a spent confirm card", async () => {
    const { db, seeded, ctx } = unconfirmedSetup();
    for (const slot of SLOTS) {
      await confirmAssumptionFromCard(ctx, { jobId: seeded.jobId, slot, expectedValue: SHOWN[slot] });
    }
    const proposed = await proposeSendFromCard(ctx, { threadId: seeded.threadId, jobId: seeded.jobId });
    const confirmCard = (proposed.ok ? proposed.messages[0]!.cards[0] : null) as ConfirmCard;
    // A stale quote card stored from before the taps.
    db.tables.pa_messages!.push({
      id: randomUUID(),
      thread_id: seeded.threadId,
      contractor_id: seeded.contractor.id,
      role: "assistant",
      content: "Here's the draft.",
      cards: [{ type: "quote", jobId: seeded.jobId, assumptions: [], canSend: false }],
      created_at: "2026-11-22T08:00:00.000Z",
    });
    let messages = await loadThread(ctx, seeded.threadId);
    const quote = messages.flatMap((m) => m.cards).find((c): c is QuoteCard => c.type === "quote")!;
    expect(quote.assumptions.every((a) => a.confirmed)).toBe(true);
    expect(quote.canSend).toBe(true);
    expect(messages.flatMap((m) => m.cards).find((c) => c.type === "confirm")).toMatchObject({ state: "pending" });

    await confirmFromCard(ctx, { threadId: seeded.threadId, pendingId: confirmCard.pendingActionId });
    messages = await loadThread(ctx, seeded.threadId);
    expect(messages.flatMap((m) => m.cards).find((c) => c.type === "confirm")).toMatchObject({ state: "done" });
  });
});

describe("assumptions", () => {
  const parse = (raw: unknown) => sowStateSchema.parse(raw);

  it("never fills a slot nobody stated", () => {
    const view = deriveAssumptions(null, null);
    expect(view.map((a) => [a.slot, a.value, a.confirmed])).toEqual([
      ["pricing_mode", null, false],
      ["crew", null, false],
      ["materials_supply", null, false],
    ]);
  });

  it("treats a voice-captured answer as confirmed unless the call flagged it unasked", () => {
    const sow = parse({ ...answeredSow, unasked_required: ["crew"] });
    const view = deriveAssumptions(sow, null);
    expect(view.find((a) => a.slot === "pricing_mode")!.confirmed).toBe(true);
    expect(view.find((a) => a.slot === "crew")!.confirmed).toBe(false);
  });

  it("on a chat draft, a value is confirmed only by the stored confirmation", () => {
    const sow = parse(answeredSow);
    const record = {
      job_id: "j",
      contractor_id: "c",
      pricing_confirmed_at: NOW.toISOString(),
      crew_confirmed_at: null,
      materials_confirmed_at: null,
    };
    const view = deriveAssumptions(sow, record);
    expect(view.map((a) => a.confirmed)).toEqual([true, false, false]);
  });
});
