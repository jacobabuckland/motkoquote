// Mints a short-lived (~1 minute) ephemeral token the browser uses to open a
// direct WebRTC connection to OpenAI's Realtime API. This is the only
// server-side call in the live conversation path — everything after this
// (audio in, audio out, transcripts, tool calls) flows over that peer
// connection directly between the browser and OpenAI, not through our
// server. Keeps the conversation duplex and low-latency instead of the old
// record → upload → transcribe → LLM → synthesize → download chain.
export type RealtimeToolDef = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type RealtimeSessionConfig = {
  instructions: string;
  tools: RealtimeToolDef[];
};

export const createRealtimeClientSecret = async (
  config: RealtimeSessionConfig,
): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: "gpt-realtime-mini",
        instructions: config.instructions,
        tools: config.tools,
        tool_choice: "auto",
        audio: {
          input: {
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: { type: "semantic_vad" },
          },
          output: { voice: "marin" },
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create Realtime session: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { value: string };
  return data.value;
};
