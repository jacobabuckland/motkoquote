// The real LlmClient, on @anthropic-ai/sdk. The only file in src/lib/pa that
// touches the network; tests inject a scripted fake instead.

import Anthropic from "@anthropic-ai/sdk";
import { PA_MODEL, PA_TEMPERATURE } from "@/lib/models";
import type { LlmClient, LlmRequest, LlmResponse } from "./types";

export const createAnthropicClient = (apiKey = process.env.ANTHROPIC_API_KEY): LlmClient => ({
  complete: async (request: LlmRequest): Promise<LlmResponse> => {
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    const client = new Anthropic({ apiKey });
    const params = {
      model: PA_MODEL,
      temperature: PA_TEMPERATURE,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages,
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      })),
      ...(request.forceTool
        ? { tool_choice: { type: "tool" as const, name: request.forceTool } }
        : {}),
    };
    const message = await client.messages.create(
      params as unknown as Anthropic.MessageCreateParamsNonStreaming,
    );
    const content: LlmResponse["content"] = [];
    for (const block of message.content) {
      if (block.type === "text") content.push({ type: "text", text: block.text });
      else if (block.type === "tool_use") {
        content.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
      }
    }
    return { content, stopReason: message.stop_reason ?? "end_turn" };
  },
});
