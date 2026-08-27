/**
 * @vitest-environment happy-dom
 */

// The live transcript rendered both speakers into one unlabelled list, and the
// label was available one line away the whole time: conversationTurnsRef
// already tags every turn from the event type it arrived on, and persists it to
// jobs.conversation_json. Only the DOM threw it away.
//
// That is why the 26 Aug report described the assistant calling Jacob "Jake".
// The line was a CONTRACTOR-channel turn — the echoed tail of the assistant's
// own greeting, transcribed back with "Jacob" heard as "Jake". Unlabelled it
// read as the model hallucinating a nickname, and a day went into hunting one.
//
// The hard constraint: jobs.transcript must keep its exact historical shape
// (voice-transcript.ts:63-66). This is a render-layer change only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobIntake } from "@/components/voice/job-intake";
import type { JobIntakeAdapter, IntakeCompletion } from "@/components/voice/job-intake-adapter";
import { EMPTY_SOW_STATE } from "@/lib/schemas/sow";
import { flatTranscript } from "@/lib/voice-transcript";

afterEach(cleanup);

type FakeChannel = {
  readyState: string;
  send: (payload: string) => void;
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

const transcriptFrame = async (type: string, transcript: string) => {
  await act(async () => {
    channel.onmessage?.({ data: JSON.stringify({ type, transcript }) });
  });
};

const ASSISTANT = "response.output_audio_transcript.done";
const CONTRACTOR = "conversation.item.input_audio_transcription.completed";

// The 26 Aug sequence, abridged: three assistant re-greetings, then the echo
// transcribed on the contractor channel with the name misheard.
const THE_ECHO_TURN = "All right, Jake.";
const THE_GREETING = "Alright Jacob — tell me about the job.";

describe("the live transcript says who spoke", () => {
  beforeEach(() => {
    installWebrtcMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attributes the assistant and the contractor differently", async () => {
    await startLiveCall();
    await transcriptFrame(ASSISTANT, THE_GREETING);
    await transcriptFrame(CONTRACTOR, THE_ECHO_TURN);

    const panel = screen.getByTestId("voice-transcript");

    // Both turns are present...
    expect(panel.textContent).toContain(THE_GREETING);
    expect(panel.textContent).toContain(THE_ECHO_TURN);
    // ...and each carries a speaker, in text. On main both render bare, and
    // "All right, Jake." reads as the assistant.
    expect(panel.textContent).toContain("Motko");
    expect(panel.textContent).toContain("You");
  });

  it("attributes the echoed line to the CONTRACTOR, not the assistant", async () => {
    // The whole point. This line is what sent a diagnosis chasing a
    // hallucination that never happened.
    await startLiveCall();
    await transcriptFrame(CONTRACTOR, THE_ECHO_TURN);

    const rows = screen.getByTestId("voice-transcript").children;
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe(`You${THE_ECHO_TURN}`);
  });

  it("preserves turn order exactly", async () => {
    await startLiveCall();
    await transcriptFrame(ASSISTANT, "first");
    await transcriptFrame(CONTRACTOR, "second");
    await transcriptFrame(ASSISTANT, "third");

    const rows = [...screen.getByTestId("voice-transcript").children].map(
      (row) => row.textContent,
    );
    expect(rows).toEqual(["Motkofirst", "Yousecond", "Motkothird"]);
  });

  it("keeps jobs.transcript byte-identical — the one thing that must not move", async () => {
    await startLiveCall();
    await transcriptFrame(ASSISTANT, THE_GREETING);
    await transcriptFrame(CONTRACTOR, THE_ECHO_TURN);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Finish/i }));
    });
    // "Finish & price it up" does not end the call outright: with the three
    // required slots still open it detours to ask them in one compact turn
    // (concludeOrAskRequired). The detour is bounded to WRAP_DETOUR_MAX_TURNS
    // assistant turns, so two response.done frames conclude it and the draft
    // runs. That bound is deliberate — see the wrap-detour comments — and this
    // test rides it rather than working around it.
    await act(async () => {
      channel.onmessage?.({ data: JSON.stringify({ type: "response.done" }) });
    });
    await act(async () => {
      channel.onmessage?.({ data: JSON.stringify({ type: "response.done" }) });
    });
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }

    const sent = completions.at(-1);
    expect(sent).toBeDefined();
    // The historical shape: the turns' texts, in order, newline separated.
    expect(sent?.transcript).toBe(`${THE_GREETING}\n${THE_ECHO_TURN}`);
    // And the labelled parallel it must stay in lockstep with.
    expect(flatTranscript(sent?.conversationTurns ?? [])).toBe(sent?.transcript);
    expect(sent?.conversationTurns.map((t) => t.speaker)).toEqual([
      "assistant",
      "contractor",
    ]);
  });
});
