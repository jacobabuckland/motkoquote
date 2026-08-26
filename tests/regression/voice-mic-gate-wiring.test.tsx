/**
 * @vitest-environment happy-dom
 */

// The greeting loop, third occurrence — and the test that should have existed
// for the first two.
//
// #210 keyed the mic gate on `callState === "speaking"`. #339 re-keyed it on
// `response.output_audio.delta`. Both hang off ONE handler for that single
// event, and it is never emitted over WebRTC: audio travels on the RTP media
// track, not as base64 chunks on the data channel. So the branch never ran, the
// hold was never constructed, `assistantSpeaking()` was permanently false, and
// the mic never shut at all.
//
// Both PRs shipped with green tests because `voice-gate.test.ts` exercises the
// hold helper in ISOLATION and never once asserts that anything calls it. A
// unit test of a component that is never mounted proves nothing about wiring.
//
// So this test drives the real data-channel handler with the real frame
// sequence captured on device (#369) and asserts the actual mic track:
//
//   +462   output_audio_buffer.started
//   +724   response.done                 <- generation finished
//   +3213  output_audio_buffer.stopped   <- playback finished
//
// It FAILS on main: with no `response.output_audio.delta` in that sequence,
// nothing ever closes the gate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobIntake } from "@/components/voice/job-intake";
import type { JobIntakeAdapter } from "@/components/voice/job-intake-adapter";
import { ASSISTANT_AUDIO_TAIL_MS, ASSISTANT_AUDIO_MAX_HOLD_MS } from "@/lib/voice-gate";
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

const installWebrtcMocks = () => {
  micTrack = { enabled: true, kind: "audio", stop: () => {} };
  const stream = {
    getTracks: () => [micTrack],
    getAudioTracks: () => [micTrack],
  };

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

  // The level meter and the working-cue tone both construct one of these.
  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    createMediaStreamSource = () => ({ connect: () => {} });
    createAnalyser = () => ({
      fftSize: 512,
      // Flat 128 is silence — the local heuristic must never fire here, so the
      // only thing moving the gate is the frame sequence under test.
      getByteTimeDomainData: (data: Uint8Array) => data.fill(128),
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

/** Renders, taps Start, completes the async connect, opens the channel. */
const startLiveCall = async () => {
  render(<JobIntake adapter={adapter} />);
  fireEvent.click(screen.getByRole("button", { name: "Start talking" }));
  // getUserMedia → offer → SDP fetch → setRemoteDescription are all awaited.
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

describe("the mic gate is actually wired to the frames the server sends", () => {
  beforeEach(() => {
    installWebrtcMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("closes the mic when playback starts", async () => {
    await startLiveCall();
    expect(micTrack.enabled).toBe(true); // contractor may speak first

    await frame("output_audio_buffer.started");

    expect(micTrack.enabled).toBe(false);
  });

  it("KEEPS the mic shut through response.done — the 2.5s echo window", async () => {
    await startLiveCall();
    await frame("output_audio_buffer.started");

    // Every frame the instrumented run saw between playback starting and the
    // buffer draining. response.done is in here, and on main it reopened the
    // mic 2,489ms before the speaker went quiet.
    await frame("response.output_audio.done");
    await frame("response.output_audio_transcript.done");
    await frame("response.content_part.done");
    await frame("conversation.item.done");
    await frame("response.output_item.done");
    await frame("response.done");
    await frame("rate_limits.updated");

    expect(micTrack.enabled).toBe(false);
  });

  it("reopens the mic only after the buffer drains, plus the tail", async () => {
    await startLiveCall();
    // Fake timers must be installed BEFORE the hold begins: `started` arms the
    // cap timer, and a timer armed on the real clock cannot be advanced on the
    // fake one.
    vi.useFakeTimers();
    await frame("output_audio_buffer.started");
    await frame("response.done");
    await frame("output_audio_buffer.stopped");

    await act(async () => {
      vi.advanceTimersByTime(ASSISTANT_AUDIO_TAIL_MS - 1);
    });
    expect(micTrack.enabled).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(micTrack.enabled).toBe(true);
  });

  it("reopens on the cap if the buffer never reports draining", async () => {
    await startLiveCall();
    vi.useFakeTimers();
    await frame("output_audio_buffer.started");
    await frame("response.done");

    // No `stopped` ever arrives.
    await act(async () => {
      vi.advanceTimersByTime(ASSISTANT_AUDIO_MAX_HOLD_MS);
    });

    // A mic that never reopens is a worse failure than an echo.
    expect(micTrack.enabled).toBe(true);
  });

  it("releases when a response is interrupted and the buffer is cleared", async () => {
    await startLiveCall();
    vi.useFakeTimers();
    await frame("output_audio_buffer.started");
    await frame("output_audio_buffer.cleared");
    await act(async () => {
      vi.advanceTimersByTime(ASSISTANT_AUDIO_TAIL_MS);
    });

    expect(micTrack.enabled).toBe(true);
  });

  it("does not depend on response.output_audio.delta, which WebRTC never sends", async () => {
    await startLiveCall();

    // The exact frames from the device run, in order, with no audio deltas —
    // because none were emitted. On main this leaves the mic open throughout.
    for (const type of [
      "session.created",
      "response.created",
      "response.output_item.added",
      "conversation.item.added",
      "response.content_part.added",
      "response.output_audio_transcript.delta",
      "output_audio_buffer.started",
      "response.output_audio_transcript.delta",
      "response.output_audio.done",
      "response.done",
    ]) {
      await frame(type);
    }

    expect(micTrack.enabled).toBe(false);
  });
});
