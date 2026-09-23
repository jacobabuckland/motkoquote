/**
 * @vitest-environment happy-dom
 */

// Motko does not talk over the question it has just asked.
//
// Reported 22 Sep from a live call, and visible in the transcript as two Motko
// turns with nothing between them:
//
//   MOTKO  "Perfect, so the quote needs to be sent out today. Anything else
//           you'd like to add?"
//   MOTKO  "Just checking in with the last details: has anything already been
//           agreed on cost — like a day rate, a fixed price, or a deposit? And
//           who's this quote for, the customer's name?"
//
// The contractor was answering the first when the second started, and said
// they were cut off. Nothing was waiting for them: the model calls wrap_up as
// its turn ends, or the question cap trips on the same `response.done`, and
// `concludeOrAskRequired` sends the compact ask immediately. A
// `response.create` starts talking the moment it lands.
//
// THIS IS THE THIRD APPEARANCE OF ONE SHAPE, and the first two fixes both
// missed it in the same way. #714 found the detour REPLACING an in-flight ask
// for the customer's name. On 12 Sep the detour's turn bound was moved off
// `response.done` and onto the contractor's turns, because counting the
// assistant's own speech spent the contractor's allowance before they could
// answer. Both are about how the detour is COUNTED. Neither stopped it being
// SENT while a question of ours was hanging in the air — which is the part the
// contractor actually experiences, and the reason the same complaint came back
// after each fix.
//
// So the wrap is held until they have had their turn: one contractor turn
// releases it, a short backstop releases it if they say nothing at all, and a
// manual "Finish & price it up" is never held, because that is the contractor
// forcing the issue.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobIntake } from "@/components/voice/job-intake";
import type { JobIntakeAdapter, IntakeCompletion } from "@/components/voice/job-intake-adapter";
import { EMPTY_SOW_STATE, type SowState } from "@/lib/schemas/sow";

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

/** The reported call: every scope slot answered, no customer name. */
const NO_NAME: SowState = {
  ...EMPTY_SOW_STATE,
  job_type: "plastering",
  labour_plan: {
    people_count: 1,
    duration_days: 2,
    crew_description: "just me",
    working_dates: "starting Monday",
  },
  deadline: { quote_by: undefined, job_by: "today" },
  materials_supply: { contractor_supplied: ["plaster"], customer_supplied: [] },
  agreed_costs: {
    day_rate: null,
    fixed_price: 350,
    deposit_amount: null,
    deposit_pct: null,
    notes: undefined,
  },
  pricing: { mode: "fixed", fixed_amount: 350 },
};

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

const adapterReturning = (state: SowState): JobIntakeAdapter => ({
  mode: "guest",
  failureBody: "",
  startSession: async () => ({ sessionKey: null, clientSecret: "ephemeral" }),
  persistDelta: async () => state,
  complete: async (input) => {
    completions.push(input);
  },
});

const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const startLiveCall = async (adapter: JobIntakeAdapter) => {
  render(<JobIntake adapter={adapter} />);
  fireEvent.click(screen.getByRole("button", { name: "Start talking" }));
  await settle();
  await act(async () => {
    channel.onopen?.();
  });
};

const frame = async (payload: Record<string, unknown>) => {
  await act(async () => {
    channel.onmessage?.({ data: JSON.stringify(payload) });
  });
  await settle();
};

/** Motko speaking. The trailing "?" is what marks a question as outstanding. */
const motkoSays = (transcript: string) =>
  frame({ type: "response.output_audio_transcript.done", transcript });

const contractorSays = (transcript: string) =>
  frame({ type: "conversation.item.input_audio_transcription.completed", transcript });

const modelCalls = (name: string, args: Record<string, unknown> = {}) =>
  frame({
    type: "response.function_call_arguments.done",
    name,
    call_id: `call_${name}`,
    arguments: JSON.stringify(args),
  });

/** Everything sent down the data channel, as text. */
const sent = () => channel.send.mock.calls.map((call) => String(call[0])).join("\n");

/** Whether the compact wrap-up ask has gone out. */
const detourWentOut = () => sent().includes("quickly ask the contractor these remaining questions");

/** The reported call, up to the moment the wrap fires. */
const upToTheWrap = async () => {
  await startLiveCall(adapterReturning(NO_NAME));
  await modelCalls("update_sow", { job_type: "plastering" });
  await motkoSays("Perfect, so the quote needs to be sent out today. Anything else you'd like to add?");
  await modelCalls("wrap_up");
};

describe("a wrap that arrives while Motko's question is still hanging", () => {
  beforeEach(() => {
    installWebrtcMocks();
  });

  it("does not send the compact ask over the top of it", async () => {
    await upToTheWrap();

    expect(detourWentOut()).toBe(false);
  });

  it("sends it as soon as the contractor has had their say", async () => {
    await upToTheWrap();
    await contractorSays("No, that's everything.");

    expect(detourWentOut()).toBe(true);
  });

  it("sends it exactly once, not once per turn", async () => {
    await upToTheWrap();
    await contractorSays("No, that's everything.");
    await contractorSays("Yeah, all good.");

    const asks = channel.send.mock.calls.filter((call) =>
      String(call[0]).includes("quickly ask the contractor these remaining questions"),
    );
    expect(asks).toHaveLength(1);
  });

  it("still carries the customer's name when it finally goes out", async () => {
    await upToTheWrap();
    await contractorSays("No, that's everything.");

    expect(sent()).toContain("the customer's name");
  });
});

describe("what does not hold the wrap", () => {
  beforeEach(() => {
    installWebrtcMocks();
  });

  it("a Motko turn that asked nothing", async () => {
    // A statement leaves no question hanging, so there is nothing to wait for
    // and the wrap goes out as it always did.
    await startLiveCall(adapterReturning(NO_NAME));
    await modelCalls("update_sow", { job_type: "plastering" });
    await motkoSays("Right, I've got all that down.");
    await modelCalls("wrap_up");

    expect(detourWentOut()).toBe(true);
  });

  it("a question the contractor has already answered", async () => {
    await startLiveCall(adapterReturning(NO_NAME));
    await modelCalls("update_sow", { job_type: "plastering" });
    await motkoSays("Anything else you'd like to add?");
    await contractorSays("No, that's the lot.");
    await modelCalls("wrap_up");

    expect(detourWentOut()).toBe(true);
  });

  it("the contractor tapping Finish, which is them forcing the issue", async () => {
    await startLiveCall(adapterReturning(NO_NAME));
    await modelCalls("update_sow", { job_type: "plastering" });
    await motkoSays("Anything else you'd like to add?");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Finish/i }));
    });
    await settle();

    expect(detourWentOut()).toBe(true);
  });
});

describe("a contractor who says nothing at all", () => {
  beforeEach(() => {
    installWebrtcMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gets the wrap released by the backstop rather than a call that hangs", async () => {
    await upToTheWrap();
    expect(detourWentOut()).toBe(false);

    // Nothing is waited FOR here -- the release is a timer, so advance it and
    // assert synchronously. See AGENTS.md on fake timers and waitFor.
    await act(async () => {
      vi.advanceTimersByTime(8_000);
    });
    await settle();

    expect(detourWentOut()).toBe(true);
  });
});
