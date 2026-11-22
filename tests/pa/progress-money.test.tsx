/**
 * @vitest-environment happy-dom
 */

import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { cleanup, render, screen, within } from "@testing-library/react";
import { PA_TOOLS } from "@/lib/pa/tools";
import { loadThread, type PaServiceContext } from "@/lib/pa/service";
import { MoneyCardView, ProgressCardView } from "@/app/chat/chat-cards";
import type { MoneyCard, ProgressCard } from "@/lib/pa/types";
import {
  NOW,
  createFakeDb,
  fakeActions,
  scriptedLlm,
  seedContractor,
  text,
  toolContext,
} from "../helpers/pa-scenario";

afterEach(cleanup);

const tool = (name: string) => {
  const found = PA_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

const world = (quoteStatus = "sent") => {
  const db = createFakeDb();
  const seeded = seedContractor(db, { quoteStatus });
  const actions = fakeActions();
  const llm = scriptedLlm([text("x")]).client;
  return { db, seeded, actions, llm, ctx: toolContext(db, seeded, llm, actions) };
};

describe("show_progress", () => {
  it("puts the job's path on screen and tells the model what happens next", async () => {
    const { seeded, ctx } = world("sent");
    const output = await tool("show_progress").run({ jobId: seeded.jobId }, ctx);
    const card = output.cards?.[0] as ProgressCard;
    expect(card.type).toBe("progress");
    expect(card.jobId).toBe(seeded.jobId);
    expect(card.stages.map((s) => s.key)).toEqual([
      "quote_sent",
      "accepted",
      "contract_signed",
      "work_complete",
      "invoiced",
      "paid",
    ].slice(0, card.stages.length));
    expect(card.stages[0]?.state).toBe("complete");
    expect(card.movesWith).toBe("customer");
    expect(card.nextStep).toMatch(/Waiting for the customer to accept/);
    expect(JSON.stringify(output.data)).toMatch(/Waiting for the customer to accept/);
  });

  it("is refused for another contractor's job in the same database", async () => {
    const db = createFakeDb();
    const mine = seedContractor(db);
    const theirs = seedContractor(db, { quoteStatus: "sent" });
    const llm = scriptedLlm([text("x")]).client;
    const ctx = toolContext(db, mine, llm, fakeActions());
    await expect(tool("show_progress").run({ jobId: theirs.jobId }, ctx)).rejects.toThrow(
      "I can't find that job.",
    );
  });

  it("is a read tool: it cannot send, charge or change anything", () => {
    expect(tool("show_progress").kind).toBe("read");
  });
});

describe("a stored progress card is rebuilt from the live job", () => {
  it("shows the stage the job is at now, not the one it was at when the message was written", async () => {
    const { db, seeded, actions, llm } = world("sent");
    const ctx: PaServiceContext = {
      db: db.client,
      contractor: seeded.contractor,
      llm,
      actions,
      now: () => NOW,
    };
    const stored: ProgressCard = {
      type: "progress",
      jobId: seeded.jobId,
      customerName: "Stale",
      title: "Stale",
      stages: [],
      movesWith: "nobody",
      nextStep: "Stale",
    };
    (db.tables.pa_messages ??= []).push({
      id: randomUUID(),
      thread_id: seeded.threadId,
      contractor_id: seeded.contractor.id,
      role: "assistant",
      content: "Here's where it's at.",
      cards: [stored],
      created_at: "2026-11-22T08:00:00.000Z",
    });
    const quote = db.tables.quotes!.find((q) => q.job_id === seeded.jobId)!;
    quote.status = "accepted";
    quote.accepted_at = "2026-11-22T09:00:00.000Z";

    const messages = await loadThread(ctx, seeded.threadId);
    const card = messages.flatMap((m) => m.cards).find((c) => c.type === "progress") as ProgressCard;
    expect(card.nextStep).not.toBe("Stale");
    expect(card.nextStep).toMatch(/contract/i);
    expect(card.movesWith).toBe("you");
    expect(card.stages.find((s) => s.key === "accepted")?.state).toBe("complete");
  });

  it("drops the card when the job has gone", async () => {
    const { db, seeded, actions, llm } = world("sent");
    const ctx: PaServiceContext = {
      db: db.client,
      contractor: seeded.contractor,
      llm,
      actions,
      now: () => NOW,
    };
    (db.tables.pa_messages ??= []).push({
      id: randomUUID(),
      thread_id: seeded.threadId,
      contractor_id: seeded.contractor.id,
      role: "assistant",
      content: "x",
      cards: [{ type: "progress", jobId: randomUUID(), stages: [] }],
      created_at: "2026-11-22T08:00:00.000Z",
    });
    const messages = await loadThread(ctx, seeded.threadId);
    expect(messages.flatMap((m) => m.cards)).toEqual([]);
  });
});

describe("get_money_position", () => {
  it("returns a money card in POUNDS from a position held in pence", async () => {
    const { ctx, actions } = world();
    actions.getMoneyPosition.mockResolvedValue({
      owedToYou: [
        { customerName: "Dave Carter", totalOwed: 45000 },
        { customerName: "Amy Lee", totalOwed: 12050 },
      ],
      whatsLeft: 100000,
      safeToSpend: { total: 80000, collected: 120000 },
      projection: { total: 125000, owedNet: 57050 },
    });
    const output = await tool("get_money_position").run({}, ctx);
    const card = output.cards?.[0] as MoneyCard;
    expect(card.owed).toBeCloseTo(570.5, 5);
    expect(card.owedBy).toEqual([
      { customerName: "Dave Carter", amount: 450 },
      { customerName: "Amy Lee", amount: 120.5 },
    ]);
    expect(card.safeToSpend).toBe(800);
    expect(card.asOf).toBe(NOW.toISOString());
  });

  it("caps the list and says how many more, and leaves out people who owe nothing", async () => {
    const { ctx, actions } = world();
    actions.getMoneyPosition.mockResolvedValue({
      owedToYou: [
        ...Array.from({ length: 7 }, (_, i) => ({ customerName: `C${i}`, totalOwed: 1000 })),
        { customerName: "Settled", totalOwed: 0 },
      ],
      whatsLeft: 0,
      safeToSpend: { total: 0, collected: 0 },
      projection: { total: 0, owedNet: 0 },
    });
    const card = (await tool("get_money_position").run({}, ctx)).cards?.[0] as MoneyCard;
    expect(card.owedBy).toHaveLength(5);
    expect(card.moreOwedBy).toBe(2);
    expect(card.owed).toBe(70);
  });
});

const progress = (overrides: Partial<ProgressCard> = {}): ProgressCard => ({
  type: "progress",
  jobId: "22222222-2222-4222-8222-222222222222",
  customerName: "Dave Carter",
  title: "rewire",
  stages: [
    { key: "quote_sent", label: "Quote sent", state: "complete", date: "2026-11-20T10:00:00.000Z" },
    { key: "accepted", label: "Accepted", state: "current", date: null },
    { key: "contract_signed", label: "Contract signed", state: "future", date: null },
  ],
  movesWith: "you",
  nextStep: "Accepted. Next is the contract.",
  ...overrides,
});

describe("the progress card", () => {
  it("draws the job page's stepper, says what is next and links to the job", () => {
    render(<ProgressCardView card={progress()} />);
    const card = screen.getByTestId("progress-card");
    expect(within(card).getByText("Dave Carter")).toBeInTheDocument();
    expect(within(card).getByText("Quote sent")).toBeInTheDocument();
    expect(within(card).getByText("In progress")).toBeInTheDocument();
    expect(within(card).getByText("Accepted. Next is the contract.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Open the job/ })).toHaveAttribute(
      "href",
      "/jobs/22222222-2222-4222-8222-222222222222",
    );
  });

  it("wears the amber keyline only while the next move is the contractor's", () => {
    const { rerender } = render(<ProgressCardView card={progress({ movesWith: "you" })} />);
    expect(screen.getByTestId("progress-card")).toHaveClass("keyline-move");
    rerender(<ProgressCardView card={progress({ movesWith: "customer" })} />);
    expect(screen.getByTestId("progress-card")).not.toHaveClass("keyline-move");
  });
});

describe("the money card", () => {
  const money = (overrides: Partial<MoneyCard> = {}): MoneyCard => ({
    type: "money",
    asOf: "2026-11-22T10:00:00.000Z",
    owed: 570.5,
    owedBy: [
      { customerName: "Dave Carter", amount: 450 },
      { customerName: "Amy Lee", amount: 120.5 },
    ],
    moreOwedBy: 0,
    safeToSpend: 800,
    ...overrides,
  });

  it("sets the total in the display face, lists who owes it, and says when it was true", () => {
    render(<MoneyCardView card={money()} />);
    const card = screen.getByTestId("money-card");
    expect(within(card).getByTestId("money-card-owed")).toHaveTextContent("£570.50");
    expect(within(card).getByTestId("money-card-owed")).toHaveClass("display");
    expect(within(card).getByText("Dave Carter")).toBeInTheDocument();
    expect(within(card).getByText("£120.50")).toBeInTheDocument();
    expect(within(card).getByText("£800.00")).toBeInTheDocument();
    expect(within(card).getByText(/As of/)).toBeInTheDocument();
  });

  it("says you're all square, rather than showing £0.00 in the hero face", () => {
    render(<MoneyCardView card={money({ owed: 0, owedBy: [] })} />);
    expect(screen.getByText(/all square/i)).toBeInTheDocument();
    expect(screen.queryByTestId("money-card-owed")).toBeNull();
  });

  it("says how many more there are past the list", () => {
    render(<MoneyCardView card={money({ moreOwedBy: 3 })} />);
    expect(screen.getByText("+ 3 more")).toBeInTheDocument();
  });
});
