import type { ChatMessageView } from "@/lib/pa/service";
import { createLineSplitter, parseEvent } from "@/lib/pa/stream-events";

// Sends a message and reads the streamed reply. Plain functions over fetch, so
// the screen holds no protocol detail and the reading can be tested without a
// browser.

export type StreamResult =
  | { ok: true; threadId: string; messages: ChatMessageView[] }
  // `dropped` means the connection ended before the reply said how it finished.
  // The server may well have finished the turn, so the caller should look at the
  // thread again rather than assume either way.
  | { ok: false; error: string; dropped?: boolean };

const DROPPED = "I lost the connection. Check the thread before sending that again.";

export const streamChat = async (
  input: { threadId: string | null; text: string },
  handlers: { onStatus: (text: string) => void; onText: (delta: string) => void },
  fetchImpl: typeof fetch = fetch,
): Promise<StreamResult> => {
  const response = await fetchImpl("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    // The route answers 401 and 400 with a small JSON body of its own.
    const body: unknown = await response.json().catch(() => null);
    const error =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : "Something went wrong. Nothing has been sent.";
    return { ok: false, error };
  }
  if (!response.body) return { ok: false, error: DROPPED, dropped: true };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const split = createLineSplitter();
  let outcome: StreamResult | null = null;

  const handle = (line: string) => {
    const event = parseEvent(line);
    if (!event || outcome) return;
    if (event.type === "status") handlers.onStatus(event.text);
    else if (event.type === "text") handlers.onText(event.delta);
    else if (event.type === "done") outcome = { ok: true, threadId: event.threadId, messages: event.messages };
    else outcome = { ok: false, error: event.error };
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of split(decoder.decode(value, { stream: true }))) handle(line);
    }
    // Whatever is left when the stream ends (a final line with no newline).
    for (const line of split(`${decoder.decode()}\n`)) handle(line);
  } catch {
    return outcome ?? { ok: false, error: DROPPED, dropped: true };
  }
  return outcome ?? { ok: false, error: DROPPED, dropped: true };
};
