// The wire format of a streamed reply: one JSON object per line (NDJSON), so
// each event can be parsed the moment its line arrives. Shared by the route that
// writes it and the client that reads it, so the two cannot drift.

import type { ChatMessageView } from "./service";

export type StreamEvent =
  // A tool is starting. Any text sent before this was the model thinking aloud.
  | { type: "status"; text: string }
  // A piece of the answer.
  | { type: "text"; delta: string }
  // Finished. `messages` are the stored pair, with their cards.
  | { type: "done"; threadId: string; messages: ChatMessageView[] }
  // Finished without an answer, with words fit to show.
  | { type: "error"; error: string };

export const encodeEvent = (event: StreamEvent): string => `${JSON.stringify(event)}\n`;

// Accumulates chunks and yields each complete line, holding back a partial one.
// Network chunks do not respect line boundaries, so this is what makes parsing
// safe.
export const createLineSplitter = () => {
  let buffer = "";
  return (chunk: string): string[] => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    return lines.filter((line) => line.trim().length > 0);
  };
};

const isEvent = (value: unknown): value is StreamEvent => {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  const type = (value as { type: unknown }).type;
  return type === "status" || type === "text" || type === "done" || type === "error";
};

// One line to one event, or null for anything that isn't one. A line that does
// not parse is dropped rather than thrown: a single bad line must not stop the
// reply that follows it.
export const parseEvent = (line: string): StreamEvent | null => {
  try {
    const value: unknown = JSON.parse(line);
    return isEvent(value) ? value : null;
  } catch {
    return null;
  }
};
