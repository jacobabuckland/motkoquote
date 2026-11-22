import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "@/lib/pa/agent";
import { statusForTool, GENERIC_STATUS } from "@/lib/pa/status-copy";
import { buildToolRegistry } from "@/lib/pa/tools";
import {
  createLineSplitter,
  encodeEvent,
  parseEvent,
  type StreamEvent,
} from "@/lib/pa/stream-events";
import { streamChat } from "@/app/chat/stream-client";
import type { AgentEvent, LlmRequest, LlmResponse } from "@/lib/pa/types";
import {
  createFakeDb,
  fakeActions,
  scriptedLlm,
  seedContractor,
  text,
  toolContext,
  toolUse,
} from "../helpers/pa-scenario";

describe("the wire format", () => {
  it("round-trips every event type, one per line", () => {
    const events: StreamEvent[] = [
      { type: "status", text: "Opening the job…" },
      { type: "text", delta: "Hello\nthere" },
      { type: "done", threadId: "t", messages: [] },
      { type: "error", error: "No." },
    ];
    for (const event of events) {
      const line = encodeEvent(event);
      expect(line.endsWith("\n")).toBe(true);
      // A newline inside the text is escaped, so it can never split the line.
      expect(line.slice(0, -1)).not.toContain("\n");
      expect(parseEvent(line.trim())).toEqual(event);
    }
  });

  it("drops a line that is not an event rather than throwing", () => {
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent('{"type":"mystery"}')).toBeNull();
    expect(parseEvent("42")).toBeNull();
    expect(parseEvent("null")).toBeNull();
  });

  it("splits lines across chunk boundaries and holds back a partial one", () => {
    const split = createLineSplitter();
    expect(split('{"type":"text","del')).toEqual([]);
    expect(split('ta":"a"}\n{"type":"text","delta":"b"}\n{"ty')).toEqual([
      '{"type":"text","delta":"a"}',
      '{"type":"text","delta":"b"}',
    ]);
    expect(split('pe":"error","error":"x"}\n')).toEqual(['{"type":"error","error":"x"}']);
  });
});

describe("status copy", () => {
  it("has a line for a known tool and a plain one for anything else, never a tool name", () => {
    expect(statusForTool("get_job")).toBe("Opening the job…");
    expect(statusForTool("show_progress")).toMatch(/up to/);
    expect(statusForTool("something_new")).toBe(GENERIC_STATUS);
    expect(GENERIC_STATUS).not.toMatch(/_/);
  });
});

describe("the agent reports what it is doing", () => {
  const setup = () => {
    const db = createFakeDb();
    const seeded = seedContractor(db);
    return { db, seeded, actions: fakeActions() };
  };

  it("says which tool is starting, then streams the answer as it is written", async () => {
    const { db, seeded, actions } = setup();
    const llm = scriptedLlm([
      toolUse("get_needs_attention", {}),
      (request: LlmRequest): LlmResponse => {
        request.onTextDelta?.("All ");
        request.onTextDelta?.("quiet.");
        return text("All quiet.");
      },
    ]);
    const events: AgentEvent[] = [];
    const result = await runAgent({
      llm: llm.client,
      system: "s",
      history: [],
      userText: "anything?",
      registry: buildToolRegistry(),
      ctx: toolContext(db, seeded, llm.client, actions),
      onEvent: (event) => events.push(event),
    });
    expect(result.reply).toBe("All quiet.");
    expect(events).toEqual([
      { type: "status", text: statusForTool("get_needs_attention") },
      { type: "text", delta: "All " },
      { type: "text", delta: "quiet." },
    ]);
  });

  it("asks the model to stream only when someone is listening", async () => {
    const { db, seeded, actions } = setup();
    const llm = scriptedLlm([text("Hi.")]);
    await runAgent({
      llm: llm.client,
      system: "s",
      history: [],
      userText: "hi",
      registry: buildToolRegistry(),
      ctx: toolContext(db, seeded, llm.client, actions),
    });
    expect(llm.requests[0]?.onTextDelta).toBeUndefined();
  });
});

// A fetch whose body arrives in the chunks given, however they fall.
const fetchOf = (chunks: string[], init: { status?: number; json?: unknown } = {}): typeof fetch =>
  (async () => {
    if (init.status && init.status !== 200) {
      return new Response(JSON.stringify(init.json ?? null), { status: init.status });
    }
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

describe("reading a streamed reply", () => {
  const handlers = () => ({ onStatus: vi.fn(), onText: vi.fn() });
  const lines = [
    encodeEvent({ type: "status", text: "Opening the job…" }),
    encodeEvent({ type: "text", delta: "Done." }),
    encodeEvent({ type: "done", threadId: "t1", messages: [] }),
  ].join("");

  it("hands over status and text as they arrive, then the stored messages", async () => {
    const h = handlers();
    const result = await streamChat({ threadId: null, text: "hi" }, h, fetchOf([lines]));
    expect(h.onStatus).toHaveBeenCalledWith("Opening the job…");
    expect(h.onText).toHaveBeenCalledWith("Done.");
    expect(result).toEqual({ ok: true, threadId: "t1", messages: [] });
  });

  it("is not thrown by chunks that cut a line, or a character, in half", async () => {
    const h = handlers();
    // One byte at a time is the worst case a network can produce.
    const bytes = lines.split("");
    const result = await streamChat({ threadId: null, text: "hi" }, h, fetchOf(bytes));
    expect(result.ok).toBe(true);
    expect(h.onText).toHaveBeenCalledTimes(1);
  });

  it("reads a final event that has no trailing newline", async () => {
    const result = await streamChat(
      { threadId: null, text: "hi" },
      handlers(),
      fetchOf([JSON.stringify({ type: "done", threadId: "t2", messages: [] })]),
    );
    expect(result).toEqual({ ok: true, threadId: "t2", messages: [] });
  });

  it("reports a stream that ends without saying how it finished as dropped", async () => {
    const result = await streamChat(
      { threadId: "t", text: "hi" },
      handlers(),
      fetchOf([encodeEvent({ type: "text", delta: "Half an ans" })]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.dropped).toBe(true);
  });

  it("passes a stated error through as words, not as a drop", async () => {
    const result = await streamChat(
      { threadId: null, text: "hi" },
      handlers(),
      fetchOf([encodeEvent({ type: "error", error: "Nothing has been sent." })]),
    );
    expect(result).toEqual({ ok: false, error: "Nothing has been sent." });
  });

  it("shows the route's own words for a 401 or 400, and a calm line for anything else", async () => {
    expect(
      await streamChat(
        { threadId: null, text: "hi" },
        handlers(),
        fetchOf([], { status: 401, json: { error: "Please sign in and try again." } }),
      ),
    ).toEqual({ ok: false, error: "Please sign in and try again." });
    const odd = await streamChat(
      { threadId: null, text: "hi" },
      handlers(),
      fetchOf([], { status: 502, json: null }),
    );
    expect(odd).toEqual({ ok: false, error: "Something went wrong. Nothing has been sent." });
  });
});

// The route, with the signed-in user and the model both replaced.
const route = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/pa/request-context", () => ({ resolveChatContext: async () => route.ctx }));

describe("POST /api/chat/stream", () => {
  beforeEach(() => {
    route.ctx = null;
  });

  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/chat/stream/route");
    const { createNextRequest } = await import("../helpers/next-request");
    return POST(
      createNextRequest({
        method: "POST",
        url: "http://localhost:3000/api/chat/stream",
        body,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  it("turns a signed-out caller away with 401 and runs nothing", async () => {
    const response = await post({ text: "hi" });
    expect(response.status).toBe(401);
  });

  it("rejects a body that is not a message with 400", async () => {
    route.ctx = {};
    expect((await post({ threadId: "not-a-uuid", text: "hi" })).status).toBe(400);
    expect((await post({ nope: true })).status).toBe(400);
  });

  it("streams the status, the words and a final done, with no buffering", async () => {
    const db = createFakeDb();
    const seeded = seedContractor(db);
    const llm = scriptedLlm([
      toolUse("get_needs_attention", {}),
      (request: LlmRequest): LlmResponse => {
        request.onTextDelta?.("Nothing urgent.");
        return text("Nothing urgent.");
      },
    ]);
    let tick = 0;
    route.ctx = {
      db: db.client,
      contractor: seeded.contractor,
      llm: llm.client,
      actions: fakeActions(),
      now: () => new Date(Date.UTC(2026, 10, 22, 10, 0, tick++)),
    };
    const response = await post({ threadId: seeded.threadId, text: "anything?" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("cache-control")).toContain("no-transform");

    const events = (await response.text())
      .split("\n")
      .filter(Boolean)
      .map((line) => parseEvent(line));
    expect(events[0]).toEqual({ type: "status", text: statusForTool("get_needs_attention") });
    expect(events).toContainEqual({ type: "text", delta: "Nothing urgent." });
    const last = events[events.length - 1];
    expect(last?.type).toBe("done");
    // Exactly one terminal event.
    expect(events.filter((e) => e?.type === "done" || e?.type === "error")).toHaveLength(1);
  });

  it("ends with an error event, not a hang, when the turn throws", async () => {
    route.ctx = {
      db: { from: () => { throw new Error("boom"); } },
      contractor: { id: "c", company_name: "X", vat_registered: false },
      llm: scriptedLlm([text("x")]).client,
      actions: fakeActions(),
      now: () => new Date(),
    };
    const response = await post({ text: "hi" });
    const events = (await response.text()).split("\n").filter(Boolean).map(parseEvent);
    expect(events[events.length - 1]).toEqual({
      type: "error",
      error: expect.stringContaining("Nothing has been sent"),
    });
  });
});
