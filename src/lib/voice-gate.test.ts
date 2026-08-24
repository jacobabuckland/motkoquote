import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_AUDIO_TAIL_MS,
  createAssistantAudioHold,
  micShouldBeEnabled,
} from "@/lib/voice-gate";

// Half-duplex gate: the mic is only live when the contractor isn't muted AND
// the assistant isn't speaking. Barge-in is explicitly unsupported — while the
// assistant speaks the mic is closed, which is what stops the on-device echo
// loop from being heard as a user turn.
describe("micShouldBeEnabled", () => {
  it("is live when listening and not muted", () => {
    expect(micShouldBeEnabled({ muted: false, assistantSpeaking: false })).toBe(true);
  });

  it("is closed while the assistant is speaking (no barge-in)", () => {
    expect(micShouldBeEnabled({ muted: false, assistantSpeaking: true })).toBe(false);
  });

  it("stays closed when muted, even while listening", () => {
    expect(micShouldBeEnabled({ muted: true, assistantSpeaking: false })).toBe(false);
  });

  it("stays closed when muted and the assistant is speaking", () => {
    expect(micShouldBeEnabled({ muted: true, assistantSpeaking: true })).toBe(false);
  });
});

// The greeting loop. "Alright Jacob — tell me about the job" fired four times
// before the conversation started, interleaved with a user turn reading
// "All right." — the tail of the assistant's own greeting, transcribed back.
//
// The gate derived `assistantSpeaking` from the call state, which left
// "speaking" on `response.done`. That frame means the model finished
// GENERATING; it says nothing about whether the phone finished PLAYING. Remote
// audio is buffered over WebRTC, so the speaker was still emitting the end of
// the sentence when the mic reopened into it.
//
// These tests are about time, so they advance a fake clock and assert
// synchronously. Never pair fake timers with waitFor (see AGENTS.md).
describe("createAssistantAudioHold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not holding before any assistant audio has arrived", () => {
    const hold = createAssistantAudioHold(() => {});
    // The contractor must be able to speak first; a hold that starts closed
    // would swallow the opening words on every call.
    expect(hold.assistantSpeaking()).toBe(false);
  });

  it("holds the mic shut while audio is arriving", () => {
    const hold = createAssistantAudioHold(() => {});
    hold.noteAssistantAudio();
    expect(hold.assistantSpeaking()).toBe(true);
  });

  it("is STILL holding just before the tail elapses — this is the bug", () => {
    const hold = createAssistantAudioHold(() => {}, 700);
    hold.noteAssistantAudio();

    // Stands in for `response.done` landing while the speaker is still playing.
    // The old gate reopened the mic at exactly this moment.
    vi.advanceTimersByTime(699);

    expect(hold.assistantSpeaking()).toBe(true);
  });

  it("releases once the tail has elapsed", () => {
    const hold = createAssistantAudioHold(() => {}, 700);
    hold.noteAssistantAudio();

    vi.advanceTimersByTime(700);

    expect(hold.assistantSpeaking()).toBe(false);
  });

  it("measures the tail from the LAST packet, not the first", () => {
    const hold = createAssistantAudioHold(() => {}, 700);
    hold.noteAssistantAudio();
    vi.advanceTimersByTime(600);
    hold.noteAssistantAudio(); // still speaking
    vi.advanceTimersByTime(600);

    // 1200ms since the first packet, 600ms since the last. A hold armed once
    // would have released mid-sentence and let the echo straight back in.
    expect(hold.assistantSpeaking()).toBe(true);

    vi.advanceTimersByTime(100);
    expect(hold.assistantSpeaking()).toBe(false);
  });

  it("releases on the tail even if no further frame ever arrives", () => {
    const hold = createAssistantAudioHold(() => {}, 700);
    hold.noteAssistantAudio();

    // No `response.done`, no more packets — a dropped data channel. The release
    // is armed by the last packet precisely so it cannot depend on a frame that
    // may never come: a mic that never reopens is worse than an echo.
    vi.advanceTimersByTime(700);

    expect(hold.assistantSpeaking()).toBe(false);
  });

  it("notifies the caller on both edges so the gate is re-applied", () => {
    const onChange = vi.fn();
    const hold = createAssistantAudioHold(onChange, 700);

    hold.noteAssistantAudio();
    expect(onChange).toHaveBeenCalledTimes(1); // closed

    vi.advanceTimersByTime(700);
    expect(onChange).toHaveBeenCalledTimes(2); // released
  });

  it("drops the hold on clear, and the pending release cannot fire later", () => {
    const onChange = vi.fn();
    const hold = createAssistantAudioHold(onChange, 700);
    hold.noteAssistantAudio();
    onChange.mockClear();

    hold.clear();
    expect(hold.assistantSpeaking()).toBe(false);

    // A timer surviving teardown would fire against the NEXT session's mic.
    vi.advanceTimersByTime(5_000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still yields a closed mic when muted, whatever the hold says", () => {
    const hold = createAssistantAudioHold(() => {}, 700);
    hold.noteAssistantAudio();
    vi.advanceTimersByTime(700);

    // Manual mute always wins — the hold releasing must never open a muted mic.
    expect(
      micShouldBeEnabled({ muted: true, assistantSpeaking: hold.assistantSpeaking() }),
    ).toBe(false);
  });

  it("composes with micShouldBeEnabled across the whole tail", () => {
    const hold = createAssistantAudioHold(() => {}, 700);
    const micLive = () =>
      micShouldBeEnabled({ muted: false, assistantSpeaking: hold.assistantSpeaking() });

    expect(micLive()).toBe(true);
    hold.noteAssistantAudio();
    expect(micLive()).toBe(false);
    vi.advanceTimersByTime(699);
    expect(micLive()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(micLive()).toBe(true);
  });
});

describe("ASSISTANT_AUDIO_TAIL_MS", () => {
  it("is a positive duration", () => {
    // A zero or negative tail is the old behaviour with extra steps: the mic
    // would reopen the instant the last packet landed, into the buffered audio
    // the speaker is still playing.
    expect(ASSISTANT_AUDIO_TAIL_MS).toBeGreaterThan(0);
  });
});
