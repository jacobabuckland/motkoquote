import { describe, expect, it } from "vitest";
import { runAgent } from "@/lib/pa/agent";
import { buildSystemPrompt } from "@/lib/pa/prompt";
import { PA_TOOLS, buildToolRegistry } from "@/lib/pa/tools";
import type { LineItem } from "@/lib/schemas/job";
import type { PaTool } from "@/lib/pa/types";
import type { FakeDb } from "../helpers/pa-fake-db";
import {
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

const tool = (name: string): PaTool => {
  const found = PA_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

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

const unpricedTap = (): LineItem =>
  materialsLine({ description: "Kitchen tap", quantity: 1, unit: "item", unit_price: 0, unpriced: true });

const addTap = (description: string) => ({
  op: "add_line" as const,
  description,
  category: "materials" as const,
  quantity: 1,
  unit: "item",
  unit_price: 85,
});

const storedLines = (db: FakeDb): LineItem[] => db.tables.quotes![0]!.line_items_json as LineItem[];

describe("pricing a line by name prices the existing unpriced line", () => {
  it("leaves exactly one Kitchen tap line at £85 when the name matches case-insensitively", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { lines: [labourLine(), unpricedTap()], sow: answeredSow });
    const llm = scriptedLlm([text("x")]);
    await tool("update_quote").run(
      { jobId: seeded.jobId, changes: [addTap("  kitchen  TAP ")] },
      toolContext(db, seeded, llm.client, writingActions(db)),
    );
    const lines = storedLines(db);
    expect(lines).toHaveLength(2);
    const taps = lines.filter((line) => line.description.toLowerCase().includes("tap"));
    expect(taps).toHaveLength(1);
    expect(taps[0]!.unit_price).toBe(85);
    expect(taps[0]!.unpriced).toBeUndefined();
    expect(taps[0]!.description).toBe("Kitchen tap");
  });

  it("still adds a new line when the matching line is already priced", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, {
      lines: [materialsLine({ description: "Kitchen tap", unit_price: 60 })],
      sow: answeredSow,
    });
    const llm = scriptedLlm([text("x")]);
    await tool("update_quote").run(
      { jobId: seeded.jobId, changes: [addTap("Kitchen tap")] },
      toolContext(db, seeded, llm.client, writingActions(db)),
    );
    expect(storedLines(db)).toHaveLength(2);
  });

  it("still adds a new line when the name does not match an unpriced line", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { lines: [unpricedTap()], sow: answeredSow });
    const llm = scriptedLlm([text("x")]);
    await tool("update_quote").run(
      { jobId: seeded.jobId, changes: [addTap("Bath tap")] },
      toolContext(db, seeded, llm.client, writingActions(db)),
    );
    expect(storedLines(db)).toHaveLength(2);
  });
});

describe("the closing reply cannot claim readiness while blockers remain", () => {
  const runTurn = async (assumptions: "unconfirmed" | "confirmed", reply: string) => {
    const db = createFakeDb();
    const seeded = seedContractor(db, { lines: [unpricedTap()], sow: answeredSow, assumptions });
    const actions = writingActions(db);
    const llm = scriptedLlm([
      toolUse("update_quote", { jobId: seeded.jobId, changes: [addTap("Kitchen tap")] }),
      text(reply),
    ]);
    return runAgent({
      llm: llm.client,
      system: "s",
      history: [],
      userText: "the tap is £85",
      registry: buildToolRegistry(),
      ctx: toolContext(db, seeded, llm.client, actions),
    });
  };

  it("drops a ready-to-send claim and names what is still outstanding", async () => {
    const result = await runTurn("unconfirmed", "Tap is priced. All in, it's ready to send.");
    expect(result.reply).not.toMatch(/ready to send/i);
    expect(result.reply).not.toMatch(/\ball in\b/i);
    expect(result.reply).toMatch(/Confirm the/);
  });

  it("leaves the model's reply alone when there are no blockers", async () => {
    const reply = "Tap is priced. All in, it's ready to send.";
    const result = await runTurn("confirmed", reply);
    expect(result.reply).toBe(reply);
  });

  it("tells the model never to call a quote ready while the tool result lists blockers", () => {
    const prompt = buildSystemPrompt({ companyName: "Sparks Ltd", today: "2026-11-23" });
    expect(prompt).toMatch(/blockers/i);
  });
});
