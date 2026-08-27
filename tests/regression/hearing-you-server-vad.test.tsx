/**
 * @vitest-environment happy-dom
 */

// "Hearing you…" reported that the ROOM was audible, not that the contractor
// was.
//
// It read `micLevel > SPEECH_RMS_THRESHOLD` — a fixed constant, never measured
// against a real handset in a real room, compared against a level meter. In a
// busy room that sits above the threshold continuously, so the indicator was
// permanently on. A confidence signal that is always on tells the contractor
// nothing, and tells them it confidently.
//
// semantic_vad is what actually decides whether a turn happened, and its
// speech_started was already being handled. speech_stopped was arriving and
// being dropped, which is half of why the indicator was driven off the level
// instead: there was nothing to turn it off.
//
// This drives the real data-channel handler, the same way the #369 gate test
// does — a unit test of a component that is never mounted proves nothing about
// wiring.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobIntake } from "@/components/voice/job-intake";
import type { JobIntakeAdapter } from "@/components/voice/job-intake-adapter";
import { EMPTY_SOW_STATE } from "@/lib/schemas/sow";

afterEach(cleanup);

type FakeTrack = { enabled: boolean; kind: string; stop: () => void };
type FakeChannel = {
  readyState: string;
  send: (payload: string) => void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  close: () => void;
};

let micTrack: FakeTrack;
let channel: FakeChannel;
/** Drives the fake analyser. 128 is silence; higher is a louder room. */
let roomLevel = 128;

const installWebrtcMocks = () => {
  micTrack = { enabled: true, kind: "audio", stop: () => {} };
  const stream = { getTracks: () => [micTrack], getAudioTracks: () => [micTrack] };

  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });

  class FakePeerConnection {
    ontrack: ((event: { streams: unknown[] }) => void) | null = null;
    addTrack = vi.fn();
    close = vi.fn();
    createOffer = vi.fn(async () => ({ type: "offer", sdp: "v=0" }));
    setLocalDescription = vi.fn(async () => {});
    setRemoteDescription = vi.fn(async () => {});
    createDataChannel = vi.fn(() => {
      channel = {
        readyState: "open",
        send: vi.fn(),
        onopen: null,
        onmessage: null,
        close: vi.fn(),
      };
      return channel;
    });
  }
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);

  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    createMediaStreamSource = () => ({ connect: () => {} });
    createAnalyser = () => ({
      fftSize: 512,
      // Whatever the room is doing. The point of these tests is that this must
      // NOT decide what the indicator says.
      getByteTimeDomainData: (data: Uint8Array) => data.fill(roomLevel),
      connect: () => {},
    });
    createOscillator = () => ({
      type: "sine",
      frequency: { value: 0 },
      connect: () => {},
      start: () => {},
      stop: () => {},
      onended: null,
    });
    createGain = () => ({
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => {},
    });
    close = async () => {};
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("Audio", class { autoplay = false; srcObject: unknown = null; });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, text: async () => "v=0", status: 200 })),
  );
};

const adapter: JobIntakeAdapter = {
  mode: "guest",
  failureBody: "",
  startSession: async () => ({ sessionKey: null, clientSecret: "ephemeral" }),
  persistDelta: async () => EMPTY_SOW_STATE,
  complete: async () => {},
};

const startLiveCall = async () => {
  render(<JobIntake adapter={adapter} />);
  fireEvent.click(screen.getByRole("button", { name: "Start talking" }));
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  await act(async () => {
    channel.onopen?.();
  });
};

const frame = async (type: string) => {
  await act(async () => {
    channel.onmessage?.({ data: JSON.stringify({ type }) });
  });
};

/** What the contractor is actually told, or null when the line is absent. */
const indicator = (): string | null => {
  if (screen.queryByText("Hearing you…")) return "Hearing you…";
  if (screen.queryByText("Go ahead…")) return "Go ahead…";
  return null;
};

/** AUDIO_SAMPLE_MS in job-intake.tsx. */
const AUDIO_SAMPLE_MS = 80;
/** SPEECH_RMS_THRESHOLD in job-intake.tsx. */
const OLD_THRESHOLD = 0.025;

/**
 * The RMS the component computes from the fake analyser, by the same formula.
 * Used only to prove the room is genuinely loud enough that the OLD rule would
 * have said "Hearing you…" — so the test cannot pass by the level never moving.
 */
const loudEnoughToTripTheOldThreshold = (): boolean =>
  Math.abs((roomLevel - 128) / 128) > OLD_THRESHOLD;

beforeEach(() => {
  vi.useFakeTimers();
  roomLevel = 128;
  installWebrtcMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the indicator follows the server's voice detection", () => {
  it("says 'Go ahead…' before any speech is detected", async () => {
    await startLiveCall();
    expect(indicator()).toBe("Go ahead…");
  });

  it("says 'Hearing you…' once semantic_vad reports speech", async () => {
    await startLiveCall();
    await frame("input_audio_buffer.speech_started");
    expect(indicator()).toBe("Hearing you…");
  });

  it("goes back to 'Go ahead…' when semantic_vad reports speech stopped", async () => {
    // speech_stopped was arriving and being dropped entirely, so nothing could
    // turn the indicator off — half the reason it was driven off the level.
    await startLiveCall();
    await frame("input_audio_buffer.speech_started");
    expect(indicator()).toBe("Hearing you…");

    await frame("input_audio_buffer.speech_stopped");
    expect(indicator()).toBe("Go ahead…");
  });
});

describe("a noisy room does not fake it", () => {
  it("stays 'Go ahead…' when the room is loud but nobody is talking to it", async () => {
    // The whole defect, and the case this file exists for.
    //
    // The level sampler runs on a setInterval every AUDIO_SAMPLE_MS, so the
    // clock has to be advanced or micLevel never leaves 0 and the test passes
    // against the OLD code too — proving nothing. Advance and assert
    // synchronously; never pair fake timers with waitFor, and never
    // runAllTimersAsync a perpetual interval (AGENTS.md records what both
    // cost).
    roomLevel = 220;
    await startLiveCall();

    await act(async () => {
      vi.advanceTimersByTime(AUDIO_SAMPLE_MS * 20);
    });

    // Sanity: the room really is loud enough to have tripped the old
    // threshold. Without this the assertion below could pass because the
    // level never moved, which is exactly how the first version of this test
    // passed against main.
    expect(loudEnoughToTripTheOldThreshold()).toBe(true);

    expect(indicator()).toBe("Go ahead…");
  });

  it("still says 'Hearing you…' in a loud room once speech is actually detected", async () => {
    // The fix must not overcorrect into never showing the signal.
    roomLevel = 200;
    await startLiveCall();
    await frame("input_audio_buffer.speech_started");
    expect(indicator()).toBe("Hearing you…");
  });
});

describe("the indicator cannot get stuck on", () => {
  it("clears when the call returns to listening after the assistant speaks", async () => {
    // #369's standing lesson: a state cleared only by an event stays stuck for
    // good the day that event does not arrive. A permanently-on "Hearing you…"
    // is the exact defect being fixed, so it is cleared on the transition too.
    await startLiveCall();
    await frame("input_audio_buffer.speech_started");
    expect(indicator()).toBe("Hearing you…");

    await frame("output_audio_buffer.started");
    await frame("output_audio_buffer.stopped");

    expect(indicator()).toBe("Go ahead…");
  });
});
