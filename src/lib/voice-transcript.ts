import { z } from "zod";

// Structured, speaker-labelled voice-intake transcript.
//
// The OpenAI Realtime stream tells us who spoke for free: an
// `input_audio_transcription.completed` event is the *contractor's* speech
// (their mic, transcribed), while an `output_audio_transcript.done` event is
// the *assistant's* read-back (what the model said). page.tsx has always known
// this at the point it accumulates the transcript, but it discarded the label
// and kept only a flat list of strings — so the persisted `jobs.transcript`
// can't tell a contractor's answer from the model's paraphrase of it, which is
// exactly the ambiguity that makes "did the model fabricate this slot?"
// unanswerable after the fact.
//
// These helpers keep the label. They are pure and deterministic so the
// accumulation logic is unit-testable without a live WebRTC session.

export type TranscriptSpeaker = "contractor" | "assistant";

export type TranscriptTurn = {
  speaker: TranscriptSpeaker;
  text: string;
  // ISO8601 wall-clock time the turn's transcript landed, so the persisted
  // record preserves ordering even if events are ever reordered downstream.
  at: string;
};

export const transcriptTurnSchema = z.object({
  speaker: z.enum(["contractor", "assistant"]),
  text: z.string(),
  at: z.string(),
});

export const transcriptTurnsSchema = z.array(transcriptTurnSchema);

// Maps a Realtime event type to the speaker it represents, or null for any
// event that is not a completed transcript turn. The two recognised types are
// precisely the pair page.tsx already accumulates into the flat transcript, so
// structured turns and the flat string stay in lockstep.
export const speakerForTranscriptEvent = (
  eventType: string,
): TranscriptSpeaker | null => {
  if (eventType === "conversation.item.input_audio_transcription.completed") {
    return "contractor";
  }
  if (eventType === "response.output_audio_transcript.done") {
    return "assistant";
  }
  return null;
};


// Does this transcript carry anything an English-only intake can use?
//
// A breath on job f453b3ae (8 Sep) was transcribed as U+C544 — 아, a Korean
// syllable — committed as a contractor turn, and the model answered that empty
// turn by repeating its opener verbatim. The session already pins
// transcription to English precisely because auto-detect "mis-fires on names,
// trade jargon and short utterances" (realtime.ts), so the pin is not where
// this gets caught.
//
// The rule is CONTENT, not length. "No" is two characters and is an answer, so
// is "10", and a length cut-off would eat both. A turn with no Latin letter and
// no digit carries nothing this app reads — and it is the shape a transcriber
// produces from silence, whether that is "." or a stray syllable.
//
// This matters beyond tidiness because the transcript is an INPUT:
// extractStatedPrices reads contractor speech looking for figures, and the
// hallucination-on-silence that models more usually produce is "Thank you." or
// "you", not a Hangul character.
//
// It does NOT stop the model re-greeting. That turn is created by the Realtime
// server's semantic_vad and answered before this code sees anything; the only
// lever there is VAD eagerness, and job-intake.tsx's own threshold comment says
// in terms that it must not be tuned on a hunch.
export const carriesContent = (text: string): boolean => /[a-z0-9]/i.test(text);

// Appends a labelled turn for a recognised transcript event, or returns the
// turns unchanged for any other event. Never mutates its input.
export const appendTranscriptTurn = (
  turns: TranscriptTurn[],
  event: { eventType: string; text: string; at: string },
): TranscriptTurn[] => {
  const speaker = speakerForTranscriptEvent(event.eventType);
  if (speaker === null) return turns;
  // Noise is not a turn. Returns the SAME array, like the unrecognised-event
  // path above, so a caller comparing by identity sees no change.
  if (!carriesContent(event.text)) return turns;
  return [...turns, { speaker, text: event.text, at: event.at }];
};

// The flat transcript string, byte-for-byte identical to the historical
// `transcriptRef.current.join("\n")` — the turns' texts, in order, newline
// separated. `jobs.transcript` must keep this exact shape.
export const flatTranscript = (turns: TranscriptTurn[]): string =>
  turns.map((turn) => turn.text).join("\n");
