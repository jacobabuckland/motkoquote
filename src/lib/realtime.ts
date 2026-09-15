// Mints a short-lived (~1 minute) ephemeral token the browser uses to open a
// direct WebRTC connection to OpenAI's Realtime API. This is the only
// server-side call in the live conversation path — everything after this
// (audio in, audio out, transcripts, tool calls) flows over that peer
// connection directly between the browser and OpenAI, not through our
// server. Keeps the conversation duplex and low-latency instead of the old
// record → upload → transcribe → LLM → synthesize → download chain.
import {
  TRANSCRIPTION_LANGUAGE,
  TRANSCRIPTION_MODEL,
  VOICE_MODEL,
} from "@/lib/models";

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

// How long semantic_vad waits before deciding the contractor has finished.
//
// A trade dictating a job speaks in one long, pausing block — areas, then crew,
// then materials, then exclusions — and the default eagerness treats a breath
// between clauses as the end of their turn. The assistant then starts talking,
// and the half-duplex mic gate closes the mic while it does (see
// createAssistantAudioHold), so whatever they say next is not merely ignored,
// it is never captured at all. On 15 Sep that lost 12.1 seconds of one run and
// 27.1 seconds of another, taking a door dimension, a returns area and a whole
// revised crew allowance with it.
//
// "low" tells the model to let them finish. The cost is a slightly longer pause
// before Motko replies; the alternative is losing what they said.
const TURN_DETECTION_PATIENT = { type: "semantic_vad", eagerness: "low" } as const;
const TURN_DETECTION_PLAIN = { type: "semantic_vad" } as const;

export const createRealtimeClientSecret = async (
  config: RealtimeSessionConfig,
): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  // `eagerness` could not be verified against the Realtime API from the
  // environment this was written in, and a session that fails to mint is a
  // contractor who cannot start a call at all. So it is sent, and a 400 falls
  // back to the shape that has always worked — the worst case is today's
  // behaviour plus one wasted round trip, never a dead voice feature. The warn
  // is how the next person finds out which branch they are on.
  let response = await requestClientSecret(apiKey, config, TURN_DETECTION_PATIENT);
  if (response.status === 400) {
    console.warn("[realtime] turn_detection eagerness rejected; retrying without it");
    response = await requestClientSecret(apiKey, config, TURN_DETECTION_PLAIN);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create Realtime session: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { value: string };
  return data.value;
};

const requestClientSecret = (
  apiKey: string,
  config: RealtimeSessionConfig,
  turnDetection: typeof TURN_DETECTION_PATIENT | typeof TURN_DETECTION_PLAIN,
): Promise<Response> =>
  fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: VOICE_MODEL,
        instructions: config.instructions,
        tools: config.tools,
        tool_choice: "auto",
        audio: {
          input: {
            // Pin transcription to English (UK contractors, English-only app)
            // rather than letting the model auto-detect a language per turn —
            // auto-detect mis-fires on names, trade jargon and short
            // utterances, occasionally transcribing a whole turn as another
            // language. `language` is an ISO-639-1 hint the transcription model
            // biases toward. The system instructions reinforce it (see the
            // englishLine in both session builders).
            transcription: { model: TRANSCRIPTION_MODEL, language: TRANSCRIPTION_LANGUAGE },
            turn_detection: turnDetection,
          },
          output: { voice: "marin" },
        },
      },
    }),
  });
