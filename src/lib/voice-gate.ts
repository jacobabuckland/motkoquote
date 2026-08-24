// Half-duplex microphone gate for the live voice intake.
//
// Bug: "When running a quote the voice skips to next question". On-device
// (iOS WKWebView) the speaker's TTS couples back into the hot microphone;
// the Realtime server's semantic_vad hears that echo as a user turn and
// interrupts, so the assistant appears to skip ahead. The fix is to stop
// feeding the mic to the connection while the assistant is speaking — a
// deliberately half-duplex call (no barge-in). A manual mute always wins.
//
// This is the deterministic, unit-testable core of the gate. The audible
// result can only be confirmed on a real device; this function only decides
// whether the mic track should be live for a given state.
export type MicGateInput = {
  muted: boolean;
  assistantSpeaking: boolean;
};

export const micShouldBeEnabled = ({ muted, assistantSpeaking }: MicGateInput): boolean =>
  !muted && !assistantSpeaking;

// How long after the LAST packet of assistant audio the mic stays shut.
//
// Bug: the greeting looped. "Alright Jacob — tell me about the job" fired four
// times before the conversation started, interleaved with a user turn reading
// "All right." — the tail of the assistant's own greeting, transcribed back.
//
// The gate used to derive `assistantSpeaking` from the call state, which left
// "speaking" on `response.done`. That frame means the model finished
// GENERATING; it says nothing about whether the phone finished PLAYING. Remote
// audio arrives over WebRTC and is buffered, so the speaker is still emitting
// the end of the sentence when it lands. The mic reopened into that tail, iOS
// coupled it into the hot microphone, the server's semantic_vad scored the echo
// as a user turn, and the model — now looking at a conversation containing
// nothing — did what its instructions say to do on connect and greeted again.
//
// Tuning: too short and the echo returns; too long and a fast talker is
// clipped. Only confirmable on a real device.
export const ASSISTANT_AUDIO_TAIL_MS = 700;

export type AssistantAudioHold = {
  /** Call on every packet of assistant audio. Re-arms the hold. */
  noteAssistantAudio: () => void;
  /** Drops the hold and cancels any pending release. For teardown. */
  clear: () => void;
  /** Feeds micShouldBeEnabled's `assistantSpeaking`. */
  assistantSpeaking: () => boolean;
};

/**
 * The hold that keeps the mic shut through the tail of the assistant's speech.
 *
 * Driven by the audio PACKETS rather than by `response.done`, and that is the
 * whole point twice over. It tracks what the speaker is actually emitting, and
 * it stays bounded even if `response.done` never arrives at all — a dropped
 * data channel, a torn-down session — because the release is armed by the last
 * packet, not by a frame that may never come. A mic that never reopens is a
 * worse failure than an echo.
 *
 * `onChange` fires whenever the answer changes, so the caller can re-apply the
 * gate; the release is otherwise invisible, being a timer rather than an event.
 */
export const createAssistantAudioHold = (
  onChange: () => void,
  tailMs: number = ASSISTANT_AUDIO_TAIL_MS,
): AssistantAudioHold => {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    noteAssistantAudio: () => {
      active = true;
      // Re-arm: the hold expires tailMs after the LAST packet, not the first.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        active = false;
        onChange();
      }, tailMs);
      onChange();
    },
    clear: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      active = false;
    },
    assistantSpeaking: () => active,
  };
};
