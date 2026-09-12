/**
 * @vitest-environment happy-dom
 */

// The wrap-up detour asked a question and then ended the call before the
// contractor could answer it.
//
// Reported 12 Sep, from a real intake. Two Motko turns back to back, then the
// draft:
//
//   YOU    That'll be the customer.
//   MOTKO  All set — the customer will supply the materials. Just to confirm,
//          what's the customer's name and the site address?
//   MOTKO  Before we wrap up, let me quickly ask the last few details: Has
//          anything already been agreed with the customer on cost…?
//   → Got it — writing up the job
//
// Two defects, both here.
//
// 1. THE TURN BOUND COUNTED MOTKO'S OWN SPEECH. `wrapDetourTurnsRef` was
//    incremented on `response.done`, which fires for the ASSISTANT'S turns —
//    including the very one delivering the detour's question. With
//    WRAP_DETOUR_MAX_TURNS at 2, asking the question spent one of the
//    contractor's two goes and one further assistant utterance spent the other.
//    The bound is now counted on the contractor's turns, which is what every
//    comment about it always claimed.
//
// 2. THE DETOUR REPLACED AN IN-FLIGHT QUESTION. `toAsk` is checklist slots
//    only, and the customer's name is not one — so a call that ended with the
//    name outstanding asked the checklist questions INSTEAD of it, over the top
//    of the question Motko had just put. The name now rides along in the same
//    compact ask. Name only: contact details and the site address stay out by
//    decision (#707).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobIntake } from "@/components/voice/job-intake";
import type { JobIntakeAdapter, IntakeCompletion } from "@/components/voice/job-intake-adapter";
import { EMPTY_SOW_STATE, CUSTOMER_NAME_QUESTION } from "@/lib/schemas/sow";

afterEach(cleanup);

type FakeChannel = {
  readyState: string;
  send: ReturnType<typeof vi.fn>;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  close: () => void;
};

let channel: FakeChannel;
let completions: IntakeCompletion[];

const installWebrtcMocks = () => {
  completions = [];
  const track = { enabled: true, kind: "audio", stop: () => {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };

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
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => "v=0" })));
};

const adapter: JobIntakeAdapter = {
  mode: "guest",
  failureBody: "",
  startSession: async () => ({ sessionKey: null, clientSecret: "ephemeral" }),
  persistDelta: async () => EMPTY_SOW_STATE,
  complete: async (input) => {
    completions.push(input);
  },
};

const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const startLiveCall = async () => {
  render(<JobIntake adapter={adapter} />);
  fireEvent.click(screen.getByRole("button", { name: "Start talking" }));
  await settle();
  await act(async () => {
    channel.onopen?.();
  });
};

const assistantTurn = async () => {
  await act(async () => {
    channel.onmessage?.({ data: JSON.stringify({ type: "response.done" }) });
  });
};

const contractorSays = async (transcript: string) => {
  await act(async () => {
    channel.onmessage?.({
      data: JSON.stringify({
        type: "conversation.item.input_audio_transcription.completed",
        transcript,
      }),
    });
  });
};

/** Everything the data channel has been asked to send, as text. */
const sentPayloads = () =>
  channel.send.mock.calls.map((call) => String(call[0])).join("\n");

const finishAndDetour = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Finish/i }));
  });
  await settle();
};

describe("the contractor gets to answer the wrap-up question", () => {
  beforeEach(() => {
    installWebrtcMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not end the call on Motko's own turns", async () => {
    await startLiveCall();
    await contractorSays("Reskimming a bathroom, three by four metres.");
    await finishAndDetour();

    // The detour's question goes out, and Motko speaks. Under the old bound
    // these two frames alone ended the call — the contractor never got a turn.
    await assistantTurn();
    await assistantTurn();
    await settle();

    expect(completions).toHaveLength(0);
  });

  it("ends once the contractor has had their two goes at it", async () => {
    await startLiveCall();
    await contractorSays("Reskimming a bathroom, three by four metres.");
    await finishAndDetour();

    await contractorSays("Two hundred a day, just me.");
    await settle();
    expect(completions).toHaveLength(0);

    await contractorSays("That's everything.");
    await settle();
    expect(completions).toHaveLength(1);
  });

  it("does not spend a turn on a breath", async () => {
    // Noise is not a turn — the same guard that keeps it out of the transcript
    // keeps it from burning one of the contractor's two goes.
    await startLiveCall();
    await contractorSays("Reskimming a bathroom, three by four metres.");
    await finishAndDetour();

    await contractorSays("  ");
    await contractorSays("…");
    await settle();

    expect(completions).toHaveLength(0);
  });
});

describe("the wrap-up ask carries the customer's name", () => {
  beforeEach(() => {
    installWebrtcMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the name alongside the checklist slots, rather than instead of them", async () => {
    // The reported failure: Motko asked for the name, then asked the wrap-up
    // question over the top of it, and the name was never captured.
    await startLiveCall();
    await contractorSays("Reskimming a bathroom, three by four metres.");
    await finishAndDetour();

    const sent = sentPayloads();
    expect(sent).toContain(CUSTOMER_NAME_QUESTION);
    // And it is genuinely combined — a checklist slot is in the same ask.
    expect(sent).toContain("Who's going to be on site");
  });

  it("does not ask for contact details or the site address", async () => {
    // A contractor mid-call does not know their customer's email off by heart,
    // and the quote editor already captures all three (#707).
    await startLiveCall();
    await contractorSays("Reskimming a bathroom, three by four metres.");
    await finishAndDetour();

    const sent = sentPayloads().toLowerCase();
    expect(sent).not.toContain("site address");
    expect(sent).not.toContain("email");
  });
});
