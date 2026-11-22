import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  confirmPendingAction,
  proposeCreateInvoice,
  proposeSendQuote,
  type GateContext,
} from "@/lib/pa/pending";
import {
  confirmFromCard,
  loadThread,
  proposeSendFromCard,
  type PaServiceContext,
} from "@/lib/pa/service";
import type { ConfirmCard } from "@/lib/pa/types";
import type { FakeDb, Row } from "../helpers/pa-fake-db";
import {
  NOW,
  answeredSow,
  createFakeDb,
  fakeActions,
  seedContractor,
  type Seeded,
} from "../helpers/pa-scenario";

const gateFor = (db: FakeDb, seeded: Seeded, actions = fakeActions(), client = db.client): GateContext => ({
  db: client,
  contractor: seeded.contractor,
  threadId: seeded.threadId,
  actions,
  now: () => NOW,
});

const pendingRow = (db: FakeDb, id: string): Row =>
  (db.tables.pa_pending_actions ?? []).find((row) => row.id === id)!;

// A send whose confirm WILL be refused: the customer's email changes after the
// card was drawn, so the fingerprint no longer matches.
const refusedSend = async () => {
  const db = createFakeDb();
  const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
  const actions = fakeActions();
  const card = await proposeSendQuote(gateFor(db, seeded, actions), seeded.jobId);
  db.tables.customers![0]!.contact = { email: "someone-else@example.com" };
  return { db, seeded, actions, card };
};

describe("N1: a second tap reports what really happened to the first", () => {
  it("a refused confirm stays refused on the second tap and never reads as done", async () => {
    const { db, seeded, actions, card } = await refusedSend();
    const gate = gateFor(db, seeded, actions);

    const first = await confirmPendingAction(gate, card.pendingActionId);
    expect(first.ok).toBe(false);
    expect(first.ok === false && first.message).toMatch(/Not sent/);

    const second = await confirmPendingAction(gate, card.pendingActionId);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.code).toBe("refused");
    // The same words the contractor already saw, not a new or softer story.
    expect(second.ok === false && second.message).toBe(first.ok === false && first.message);
    expect(actions.sendQuote).not.toHaveBeenCalled();
  });

  it("records the outcome on the row: refused with the words, done on success", async () => {
    const refused = await refusedSend();
    await confirmPendingAction(gateFor(refused.db, refused.seeded, refused.actions), refused.card.pendingActionId);
    const row = pendingRow(refused.db, refused.card.pendingActionId);
    expect(row.outcome).toBe("refused");
    expect(String(row.outcome_message)).toMatch(/Not sent/);

    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
    const actions = fakeActions();
    const gate = gateFor(db, seeded, actions);
    const card = await proposeSendQuote(gate, seeded.jobId);
    expect((await confirmPendingAction(gate, card.pendingActionId)).ok).toBe(true);
    expect(pendingRow(db, card.pendingActionId).outcome).toBe("done");
    const again = await confirmPendingAction(gate, card.pendingActionId);
    expect(again.ok === false && again.code).toBe("already_done");
    expect(actions.sendQuote).toHaveBeenCalledTimes(1);
  });

  it("an action that throws is recorded as refused, and a second tap says so", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
    const actions = fakeActions();
    actions.sendQuote.mockRejectedValue(new Error("Twilio is down"));
    const gate = gateFor(db, seeded, actions);
    const card = await proposeSendQuote(gate, seeded.jobId);
    const first = await confirmPendingAction(gate, card.pendingActionId);
    expect(first.ok).toBe(false);
    expect(first.ok === false && first.message).toMatch(/didn't go through/);
    const second = await confirmPendingAction(gate, card.pendingActionId);
    expect(second.ok === false && second.code).toBe("refused");
  });

  it("a claimed row with NO recorded outcome is 'can't tell', never done", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
    const gate = gateFor(db, seeded);
    const card = await proposeSendQuote(gate, seeded.jobId);
    // The request died after the claim and before anything was recorded.
    pendingRow(db, card.pendingActionId).confirmed_at = NOW.toISOString();
    const result = await confirmPendingAction(gate, card.pendingActionId);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe("in_doubt");
    expect(result.ok === false && result.message).toMatch(/can't tell/);
  });

  it("if recording the outcome fails, the tap still gets the real result and a later tap says 'can't tell'", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
    const actions = fakeActions();
    // A client whose outcome write blows up; everything else is the real fake.
    const failing = {
      from: (table: string) => {
        const builder = db.client.from(table);
        const update = builder.update.bind(builder);
        builder.update = ((payload: Record<string, unknown>) => {
          if ("outcome" in payload) throw new Error("db down");
          return update(payload);
        }) as typeof builder.update;
        return builder;
      },
    } as unknown as typeof db.client;
    const gate = gateFor(db, seeded, actions, failing);
    const card = await proposeSendQuote(gate, seeded.jobId);
    const first = await confirmPendingAction(gate, card.pendingActionId);
    expect(first.ok).toBe(true);
    const second = await confirmPendingAction(gate, card.pendingActionId);
    expect(second.ok === false && second.code).toBe("in_doubt");
  });
});

const ctxFor = (db: FakeDb, seeded: Seeded, actions = fakeActions()): PaServiceContext =>
  ({
    db: db.client,
    contractor: seeded.contractor,
    actions,
    now: () => NOW,
  }) as unknown as PaServiceContext;

describe("N1 through the service and the thread the contractor sees", () => {
  const confirmCardOf = (proposed: Awaited<ReturnType<typeof proposeSendFromCard>>) =>
    (proposed.ok ? proposed.messages[0]!.cards[0] : null) as ConfirmCard;

  it("the tap after a refusal is an error with the refusal, not a calm no-op", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
    const actions = fakeActions();
    const ctx = ctxFor(db, seeded, actions);
    const card = confirmCardOf(await proposeSendFromCard(ctx, { threadId: seeded.threadId, jobId: seeded.jobId }));
    db.tables.customers![0]!.contact = { email: "someone-else@example.com" };
    const input = { threadId: seeded.threadId, pendingId: card.pendingActionId };

    const first = await confirmFromCard(ctx, input);
    const second = await confirmFromCard(ctx, input);
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toBe(first.ok === false && first.error);
    expect(actions.sendQuote).not.toHaveBeenCalled();
  });

  it("reloading the thread shows the card as refused (with the words), done, or unknown", async () => {
    // refused
    const refused = await refusedSend();
    const refusedCtx = ctxFor(refused.db, refused.seeded, refused.actions);
    await refusedCtx.db.from("pa_messages").insert({
      thread_id: refused.seeded.threadId,
      contractor_id: refused.seeded.contractor.id,
      role: "assistant",
      content: "Check the details, then confirm.",
      cards: [refused.card],
      created_at: NOW.toISOString(),
    });
    await confirmPendingAction(gateFor(refused.db, refused.seeded, refused.actions), refused.card.pendingActionId);
    const shown = async (ctx: PaServiceContext, threadId: string) => {
      const messages = await loadThread(ctx, threadId);
      return messages.flatMap((m) => m.cards).find((c) => c.type === "confirm") as ConfirmCard;
    };
    const refusedCard = await shown(refusedCtx, refused.seeded.threadId);
    expect(refusedCard.state).toBe("refused");
    expect(refusedCard.outcomeMessage).toMatch(/Not sent/);

    // unknown: claimed, nothing recorded
    pendingRow(refused.db, refused.card.pendingActionId).outcome = null;
    pendingRow(refused.db, refused.card.pendingActionId).outcome_message = null;
    expect((await shown(refusedCtx, refused.seeded.threadId)).state).toBe("unknown");

    // done
    pendingRow(refused.db, refused.card.pendingActionId).outcome = "done";
    expect((await shown(refusedCtx, refused.seeded.threadId)).state).toBe("done");
  });
});

describe("N2: superseding an old proposal can never delete a spent one", () => {
  it("a tap that lands between the select and the delete keeps its row", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { sow: answeredSow, assumptions: "confirmed" });
    const first = await proposeSendQuote(gateFor(db, seeded), seeded.jobId);

    // Simulate the race: the moment the delete is issued, the user's tap has
    // already claimed the row.
    const racing = {
      from: (table: string) => {
        const builder = db.client.from(table);
        if (table !== "pa_pending_actions") return builder;
        const del = builder.delete.bind(builder);
        builder.delete = (() => {
          for (const row of db.tables.pa_pending_actions ?? []) {
            if (row.id === first.pendingActionId) row.confirmed_at = NOW.toISOString();
          }
          return del();
        }) as typeof builder.delete;
        return builder;
      },
    } as unknown as typeof db.client;

    await proposeSendQuote(gateFor(db, seeded, fakeActions(), racing), seeded.jobId);
    const survivor = pendingRow(db, first.pendingActionId);
    expect(survivor, "the spent row must still exist").toBeDefined();
    expect(survivor.confirmed_at).toBe(NOW.toISOString());
  });
});

describe("N3: an invoice is refused if the amount moved after the card was shown", () => {
  const acceptedJob = () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { quoteStatus: "accepted", sow: answeredSow });
    db.tables.quotes![db.tables.quotes!.length - 1]!.total = 1000;
    const contract: Row = {
      id: randomUUID(),
      quote_id: seeded.quoteId,
      status: "signed",
      sent_at: null,
      signed_at: null,
      declined_at: null,
      withdrawn_at: null,
      deposit_pct: 25,
    };
    db.tables.contracts = [contract];
    return { db, seeded, contract };
  };

  it("raises nothing when the deposit percentage changed, and says why", async () => {
    const { db, seeded, contract } = acceptedJob();
    const actions = fakeActions();
    const gate = gateFor(db, seeded, actions);
    const card = await proposeCreateInvoice(gate, seeded.jobId, "deposit");
    expect(card.summary).toContain("£250.00");

    contract.deposit_pct = 50; // the contractor edits the contract after the card
    const result = await confirmPendingAction(gate, card.pendingActionId);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/amount changed/);
    expect(actions.createInvoice).not.toHaveBeenCalled();
    // and the refusal sticks on a second tap
    const again = await confirmPendingAction(gate, card.pendingActionId);
    expect(again.ok === false && again.code).toBe("refused");
  });

  it("raises it when nothing moved", async () => {
    const { db, seeded } = acceptedJob();
    const actions = fakeActions();
    const gate = gateFor(db, seeded, actions);
    const card = await proposeCreateInvoice(gate, seeded.jobId, "deposit");
    expect((await confirmPendingAction(gate, card.pendingActionId)).ok).toBe(true);
    expect(actions.createInvoice).toHaveBeenCalledTimes(1);
  });
});
