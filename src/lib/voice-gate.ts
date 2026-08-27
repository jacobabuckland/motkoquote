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

// How long after the output audio buffer reports STOPPED the mic stays shut.
//
// `output_audio_buffer.stopped` is emitted when the server-side output buffer
// drains. The last packets are still in flight and sitting in the device's
// jitter buffer when it lands, so a short tail covers the gap between "no more
// audio is coming" and "the speaker is actually quiet". Tune on a real device.
export const ASSISTANT_AUDIO_TAIL_MS = 300;

// Absolute cap on a single hold, and the reason this helper is not simply a
// boolean.
//
// `output_audio_buffer.stopped` is undocumented, has been reported to arrive
// late, and could be withdrawn by the provider without notice. If it never
// arrives the mic must still reopen: a mic that never reopens is a worse
// failure than an echo, because the contractor cannot be heard and has no way
// to find out why. Sized well above any plausible single assistant turn.
export const ASSISTANT_AUDIO_MAX_HOLD_MS = 30_000;

export type AssistantAudioHold = {
  /** The assistant's audio started playing. Shuts the mic. */
  beginAssistantAudio: () => void;
  /** The audio buffer drained. Releases after ASSISTANT_AUDIO_TAIL_MS. */
  endAssistantAudio: () => void;
  /** Drops the hold and cancels every pending timer. For teardown. */
  clear: () => void;
  /** Feeds micShouldBeEnabled's `assistantSpeaking`. */
  assistantSpeaking: () => boolean;
};

/**
 * The hold that keeps the mic shut while the assistant is audibly speaking.
 *
 * Driven by the OUTPUT AUDIO BUFFER events, and that is the whole point.
 *
 * The two previous versions of this gate were both inert, for the same reason.
 * #210 keyed on `callState === "speaking"`; #339 keyed on
 * `response.output_audio.delta`. Both of those hang off a single handler for
 * `response.output_audio.delta` — and **that event is never emitted over
 * WebRTC**. Over this transport the audio travels on the RTP media track, not
 * as base64 chunks on the data channel; `response.output_audio.delta` is a
 * WebSocket-transport event. So the branch never ran, the hold was never
 * created, `assistantSpeaking()` was permanently false, and the mic never shut
 * at all. Instrumented 26 Aug against gpt-realtime-mini-2025-12-15 — see #369
 * for the frame log.
 *
 * What that run also showed is why `response.done` cannot be the release
 * signal: generation finished at +724ms and playback at +3213ms, a 2.5-second
 * window in which the speaker is still emitting and the mic was wide open.
 *
 * `onChange` fires whenever the answer changes, so the caller can re-apply the
 * gate; the release is otherwise invisible, being a timer rather than an event.
 */
export const createAssistantAudioHold = (
  onChange: () => void,
  tailMs: number = ASSISTANT_AUDIO_TAIL_MS,
  maxHoldMs: number = ASSISTANT_AUDIO_MAX_HOLD_MS,
): AssistantAudioHold => {
  let active = false;
  let tailTimer: ReturnType<typeof setTimeout> | null = null;
  let capTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (tailTimer) clearTimeout(tailTimer);
    if (capTimer) clearTimeout(capTimer);
    tailTimer = null;
    capTimer = null;
  };

  const release = () => {
    clearTimers();
    if (!active) return;
    active = false;
    onChange();
  };

  return {
    beginAssistantAudio: () => {
      // A second `started` mid-hold cancels any pending tail and re-arms the
      // cap, but must not re-notify: the answer has not changed.
      const wasActive = active;
      clearTimers();
      active = true;
      capTimer = setTimeout(release, maxHoldMs);
      if (!wasActive) onChange();
    },
    endAssistantAudio: () => {
      // A `stopped` with no matching `started` is not a release — there is
      // nothing being held, and arming a tail would fire onChange spuriously.
      if (!active) return;
      if (tailTimer) clearTimeout(tailTimer);
      tailTimer = setTimeout(release, tailMs);
    },
    clear: () => {
      clearTimers();
      active = false;
    },
    assistantSpeaking: () => active,
  };
};
