// The agent loop. Pure: it takes an injectable LlmClient, the history, a system
// prompt and a tool registry, and loops tool-call -> tool-result until the model
// answers in text — or until the hard iteration cap, whichever comes first.
//
// What this file guarantees, because the rest of the design leans on it:
//   * It terminates. `maxIterations` bounds model calls, `MAX_TOOL_CALLS_PER_TURN`
//     bounds tool executions, and an exhausted cap returns a safe message.
//   * Only registered tools run. An unknown name (a model asking for
//     "confirm_action", say) gets an error result, not an execution.
//   * Tool results go back to the model as DATA, wrapped and labelled untrusted:
//     they carry customer-supplied text (names, addresses, notes).
//   * It never throws on a model or tool failure. The contractor gets a short,
//     honest message and nothing has been sent.

import { statusForTool } from "./status-copy";
import type {
  AgentEvent,
  Card,
  LlmClient,
  LlmContentBlock,
  LlmMessage,
  LlmToolResultBlock,
  LlmToolUseBlock,
  ToolContext,
  ToolRegistry,
} from "./types";

export const DEFAULT_MAX_ITERATIONS = 8;
export const MAX_TOOL_CALLS_PER_TURN = 12;
const MAX_TOKENS = 1500;
const MAX_ERROR_CHARS = 300;

export const ITERATION_CAP_MESSAGE =
  "I got tangled up on that one, so I've stopped. Nothing has been sent or changed beyond what's on screen. Try it again in a simpler way.";
export const LLM_FAILURE_MESSAGE =
  "I couldn't get my thinking straight just now. Nothing has been sent. Try again in a moment.";

export type ToolCallRecord = { name: string; ok: boolean };

export type AgentResult = {
  reply: string;
  cards: Card[];
  toolCalls: ToolCallRecord[];
  hitIterationCap: boolean;
  failed: boolean;
};

// Tool output is data from the database, some of it typed by customers. It is
// wrapped and labelled so the model has no reason to read it as an instruction;
// the system prompt says the same. The wrapper is a convenience: the real
// defence is structural — no tool the model holds can send, charge, mark paid
// or delete (see tools.ts and pending.ts).
export const wrapToolData = (data: unknown): string =>
  `<tool_data untrusted="true">\n${JSON.stringify(data)}\n</tool_data>`;

const errorMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").slice(0, MAX_ERROR_CHARS);
};

export const runAgent = async (options: {
  llm: LlmClient;
  system: string;
  history: LlmMessage[];
  userText: string;
  registry: ToolRegistry;
  ctx: ToolContext;
  maxIterations?: number;
  // Told as it goes: a tool starting, and the answer arriving. Optional.
  onEvent?: (event: AgentEvent) => void;
}): Promise<AgentResult> => {
  const { llm, system, history, userText, registry, ctx, onEvent } = options;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const messages: LlmMessage[] = [...history, { role: "user", content: userText }];
  const cards: Card[] = [];
  const toolCalls: ToolCallRecord[] = [];
  let toolCallsRun = 0;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let response;
    try {
      response = await llm.complete({
        system,
        messages,
        tools: registry.defs,
        maxTokens: MAX_TOKENS,
        ...(onEvent ? { onTextDelta: (delta: string) => onEvent({ type: "text", delta }) } : {}),
      });
    } catch {
      return {
        reply: LLM_FAILURE_MESSAGE,
        cards,
        toolCalls,
        hitIterationCap: false,
        failed: true,
      };
    }

    const uses = response.content.filter(
      (block): block is LlmToolUseBlock => block.type === "tool_use",
    );

    if (uses.length === 0) {
      const text = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();
      return {
        reply: text || "Done.",
        cards,
        toolCalls,
        hitIterationCap: false,
        failed: false,
      };
    }

    messages.push({ role: "assistant", content: response.content as LlmContentBlock[] });

    const results: LlmToolResultBlock[] = [];
    for (const use of uses) {
      const tool = registry.tools.find((candidate) => candidate.name === use.name);
      if (!tool || toolCallsRun >= MAX_TOOL_CALLS_PER_TURN) {
        toolCalls.push({ name: use.name, ok: false });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: !tool ? `Unknown tool "${use.name}".` : "Too many tool calls this turn.",
          is_error: true,
        });
        continue;
      }
      toolCallsRun += 1;
      onEvent?.({ type: "status", text: statusForTool(use.name) });
      try {
        const output = await tool.run(use.input, ctx);
        if (output.cards) cards.push(...output.cards);
        toolCalls.push({ name: use.name, ok: true });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: wrapToolData(output.data),
        });
      } catch (error) {
        toolCalls.push({ name: use.name, ok: false });
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: errorMessage(error),
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return {
    reply: ITERATION_CAP_MESSAGE,
    cards,
    toolCalls,
    hitIterationCap: true,
    failed: false,
  };
};
