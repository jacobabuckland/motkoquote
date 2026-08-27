import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_AUDIO_MAX_HOLD_MS,
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

// The greeting loop, third occurrence. #210 keyed this gate on
// `callState === "speaking"`; #339 re-keyed it on
// `response.output_audio.delta`. Both hang off a single handler for that one
// event — and it is NEVER emitted over WebRTC, where audio travels on the RTP
// media track rather than as base64 chunks on the data channel. So the branch
// never ran, the hold was never created, and the mic never shut at all.
//
// Instrumented 26 Aug against gpt-realtime-mini-2025-12-15 (#369):
//
//   +462   output_audio_buffer.started
//   +724   response.done          <- generation finished
//   +3213  output_audio_buffer.stopped   <- playback finished
//
// 2.5 seconds of live speech with the mic wide open. The hold is now driven by
// that started/stopped pair.
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

  it("is not holding before any assistant audio has started", () => {
    const hold = createAssistantAudioHold(() => {});
    // The contractor must be able to speak first; a hold that starts closed
    // would swallow the opening words on every call.
    expect(hold.assistantSpeaking()).toBe(false);
  });

  it("holds the mic shut from the moment playback starts", () => {
    const hold = createAssistantAudioHold(() => {});
    hold.beginAssistantAudio();
    expect(hold.assistantSpeaking()).toBe(true);
  });

  it("KEEPS holding across response.done — this is the bug", () => {
    const hold = createAssistantAudioHold(() => {});
    hold.beginAssistantAudio();

    // response.done lands here. It carries no information about playback and
    // must not release anything; nothing in this helper is even told about it.
    vi.advanceTimersByTime(2_489);

    expect(hold.assistantSpeaking()).toBe(true);
  });

  it("is STILL holding just before the tail elapses", () => {
    const hold = createAssistantAudioHold(() => {});
    hold.beginAssistantAudio();
    hold.endAssistantAudio();

    vi.advanceTimersByTime(ASSISTANT_AUDIO_TAIL_MS - 1);

    expect(hold.assistantSpeaking()).toBe(true);
  });

  it("releases once the tail has elapsed after the buffer drained", () => {
    const hold = createAssistantAudioHold(() => {});
    hold.beginAssistantAudio();
    hold.endAssistantAudio();

    vi.advanceTimersByTime(ASSISTANT_AUDIO_TAIL_MS);

    expect(hold.assistantSpeaking()).toBe(false);
  });

  it("measures the tail from the buffer draining, not from playback starting", () => {
    const hold = createAssistantAudioHold(() => {});
    hold.beginAssistantAudio();

    // A long turn. The old implementation released a fixed tail after the last
    // audio PACKET, which over WebRTC never arrives at all.
    vi.advanceTimersByTime(10_000);
    expect(hold.assistantSpeaking()).toBe(true);

    hold.endAssistantAudio();
    vi.advanceTimersByTime(ASSISTANT_AUDIO_TAIL_MS - 1);
    expect(hold.assistantSpeaking()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(hold.assistantSpeaking()).toBe(false);
  });

  it("releases on the cap even if `stopped` never arrives at all", () => {
    const hold = createAssistantAudioHold(() => {});
    hold.beginAssistantAudio();

    // output_audio_buffer.stopped is undocumented and has been reported to
    // arrive late or not at all. A mic that never reopens is a worse failure
    // than an echo: the contractor cannot be heard and cannot find out why.
    vi.advanceTimersByTime(ASSISTANT_AUDIO_MAX_HOLD_MS - 1);
    expect(hold.assistantSpeaking()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(hold.assistantSpeaking()).toBe(false);
  });

  it("a second `started` mid-hold extends it without re-notifying", () => {
    const onChange = vi.fn();
    const hold = createAssistantAudioHold(onChange);

    hold.beginAssistantAudio();
    expect(onChange).toHaveBeenCalledTimes(1);

    hold.endAssistantAudio();
    vi.advanceTimersByTime(ASSISTANT_AUDIO_TAIL_MS - 1);

    // More audio before the tail expired — the pending release is cancelled.
    hold.beginAssistantAudio();
    vi.advanceTimersByTime(ASSISTANT_AUDIO_TAIL_MS);

    expect(hold.assistantSpeaking()).toBe(true);
    // The answer never changed, so the gate must not be re-applied.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("ignores a `stopped` with no matching `started`", () => {
    const onChange = vi.fn();
    const hold = createAssistantAudioHold(onChange);

    hold.endAssistantAudio();
    vi.advanceTimersByTime(ASSISTANT_AUDIO_TAIL_MS * 2);

    expect(hold.assistantSpeaking()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("notifies the caller on both edges so the gate is re-applied", () => {
    const onChange = vi.fn();
    const hold = createAssistantAudioHold(onChange);

    hold.beginAssistantAudio();
    expect(onChange).toHaveBeenCalledTimes(1);

    hold.endAssistantAudio();
    vi.advanceTimersByTime(ASSISTANT_AUDIO_TAIL_MS);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("drops the hold on clear, and no pending timer can fire later", () => {
    const onChange = vi.fn();
    const hold = createAssistantAudioHold(onChange);

    hold.beginAssistantAudio();
    hold.endAssistantAudio();
    hold.clear();

    expect(hold.assistantSpeaking()).toBe(false);
    onChange.mockClear();

    // Past both the tail and the cap: a call-scoped timer must never fire
    // against the next session's mic track.
    vi.advanceTimersByTime(ASSISTANT_AUDIO_MAX_HOLD_MS * 2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still yields a closed mic when muted, whatever the hold says", () => {
    const hold = createAssistantAudioHold(() => {});
    hold.beginAssistantAudio();
    hold.endAssistantAudio();
    vi.advanceTimersByTime(ASSISTANT_AUDIO_TAIL_MS);

    expect(hold.assistantSpeaking()).toBe(false);
    expect(
      micShouldBeEnabled({ muted: true, assistantSpeaking: hold.assistantSpeaking() }),
    ).toBe(false);
  });

  it("composes with micShouldBeEnabled across a whole turn", () => {
    const hold = createAssistantAudioHold(() => {});
    const micLive = () =>
      micShouldBeEnabled({ muted: false, assistantSpeaking: hold.assistantSpeaking() });

    expect(micLive()).toBe(true); // before the assistant speaks

    hold.beginAssistantAudio();
    expect(micLive()).toBe(false); // +462  playback started

    vi.advanceTimersByTime(262);
    expect(micLive()).toBe(false); // +724  response.done — still shut

    vi.advanceTimersByTime(2_489);
    expect(micLive()).toBe(false); // +3213 still shut, buffer not yet drained

    hold.endAssistantAudio();
    vi.advanceTimersByTime(ASSISTANT_AUDIO_TAIL_MS);
    expect(micLive()).toBe(true); // released after the tail
  });
});

describe("the tuning constants", () => {
  it("are positive durations", () => {
    expect(ASSISTANT_AUDIO_TAIL_MS).toBeGreaterThan(0);
    expect(ASSISTANT_AUDIO_MAX_HOLD_MS).toBeGreaterThan(0);
  });

  it("cap the hold well above a single turn, and above the tail", () => {
    // The cap is a backstop against a missing `stopped`, not a normal release
    // path. If it were close to the tail it would cut real speech short.
    expect(ASSISTANT_AUDIO_MAX_HOLD_MS).toBeGreaterThan(ASSISTANT_AUDIO_TAIL_MS * 10);
  });
});
