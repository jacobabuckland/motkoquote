import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resolveChatContext } from "@/lib/pa/request-context";
import { handleUserMessage } from "@/lib/pa/service";
import { encodeEvent, type StreamEvent } from "@/lib/pa/stream-events";

// A chat message, answered as a stream: the tool Motko is using, then the words
// as they are written, then the stored messages. Authenticated like every other
// chat request: the signed-in user is resolved to their contractor, and the
// thread id in the body is a claim checked against that contractor, never
// trusted.
//
// The reply is one JSON event per line (see stream-events.ts). Whatever happens,
// the stream ends with exactly one `done` or `error` event, so the client always
// knows how it finished.

const bodySchema = z.object({
  threadId: z.string().uuid().nullish(),
  text: z.string(),
});

export const POST = async (request: NextRequest) => {
  const ctx = await resolveChatContext();
  if (!ctx) {
    return NextResponse.json({ error: "Please sign in and try again." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Something looks off. Try again." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A reader that has gone away makes enqueue throw. The reply is still
      // being stored server-side, so that is not a failure worth surfacing.
      const emit = (event: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          // The client disconnected.
        }
      };
      try {
        const result = await handleUserMessage(ctx, parsed.data, { onEvent: emit });
        emit(
          result.ok
            ? { type: "done", threadId: result.threadId, messages: result.messages }
            : { type: "error", error: result.error },
        );
      } catch {
        emit({ type: "error", error: "Something went wrong. Nothing has been sent." });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Nothing may buffer this: the point is that it arrives as it is written.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
};
