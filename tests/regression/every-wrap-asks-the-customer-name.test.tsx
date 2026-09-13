/**
 * @vitest-environment happy-dom
 */

// No way of ending a call skips the customer's name.
//
// Reported 13 Sep, from a live quote. The SoW came back with CUSTOMER blank and
// the transcript shows why — Motko went straight from the last checklist answer
// to "If there's nothing else, I've got what I need to put the quote together.
// I'll wrap it up here." The name was never put.
//
// #714 made the wrap-up DETOUR carry the name (buildCombinedWrapInstruction),
// which was necessary and not sufficient: the detour is only one of the ways a
// call ends. Two exits went straight to finishConversation and never consulted
// it —
//
//   1. `maybeStartFollowups`, when the free-form description already answered
//      every checklist slot, so there were no follow-ups to run.
//   2. `askNextQuestion`, when the follow-up queue drained.
//
// Both are "the CHECKLIST is complete", and the name is not a checklist slot —
// so both ended a call with it outstanding. They now route through
// `concludeOrAskRequired` like every other exit, which finishes immediately
// when there is genuinely nothing left to ask.
//
// This is the enforcement half only. Making the name a first-class slot on the
// askQuestion path — recorded in askedRequiredSlotsRef, asked in the flow
// rather than at the wrap — is #707 and is not done here.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JobIntake } from "@/components/voice/job-intake";
import type { JobIntakeAdapter, IntakeCompletion } from "@/components/voice/job-intake-adapter";
import { EMPTY_SOW_STATE, CUSTOMER_NAME_QUESTION, type SowState } from "@/lib/schemas/sow";

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

// Every checklist slot answered, and NO customer name — the shape the reported
// call ended in. `getUnansweredChecklistQuestions` returns [] against this, so
// both exits under test are reachable.
const CHECKLIST_COMPLETE: SowState = {
  ...EMPTY_SOW_STATE,
  job_type: "plastering",
  labour_plan: {
    people_count: 1,
    duration_days: 2,
    crew_description: "just me",
    working_dates: "starting the 21st",
  },
  deadline: { quote_by: undefined, job_by: "end of the month" },
  materials_supply: { contractor_supplied: ["plaster"], customer_supplied: [] },
  agreed_costs: {
    day_rate: null,
    fixed_price: 350,
    deposit_amount: null,
    notes: undefined,
  },
  pricing: { mode: "fixed", fixed_amount: 350 },
};

// The same job, with the name captured. Nothing is outstanding, so no detour
// should run at all.
const NAME_CAPTURED: SowState = { ...CHECKLIST_COMPLETE, customer_name: "Mrs Okafor" };

// One slot short — used to drive the follow-up queue so it has something to
// drain.
const ONE_SLOT_OPEN: SowState = { ...CHECKLIST_COMPLETE, materials_supply: null };

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

/** An adapter whose persistDelta hands back whatever SoW the test is driving. */
const adapterReturning = (states: SowState[]): JobIntakeAdapter => {
  let call = 0;
  return {
    mode: "guest",
    failureBody: "",
    startSession: async () => ({ sessionKey: null, clientSecret: "ephemeral" }),
    persistDelta: async () => states[Math.min(call++, states.length - 1)] ?? EMPTY_SOW_STATE,
    complete: async (input) => {
      completions.push(input);
    },
  };
};

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

/** The model reporting scope back, which is what populates the SoW. */
const modelCalls = async (name: string, args: Record<string, unknown> = {}) => {
  await act(async () => {
    channel.onmessage?.({
      data: JSON.stringify({
        type: "response.function_call_arguments.done",
        name,
        call_id: `call_${name}`,
        arguments: JSON.stringify(args),
      }),
    });
  });
  await settle();
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

describe("a call whose checklist filled itself in while describing the job", () => {
  beforeEach(() => {
    installWebrtcMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("still asks for the customer's name before wrapping", async () => {
    // maybeStartFollowups' no-follow-ups path. This finished outright before,
    // which is the reported defect.
    await startLiveCall(adapterReturning([CHECKLIST_COMPLETE]));
    await contractorSays("Reskim three rooms, fixed at three fifty, starting the 21st.");
    await modelCalls("update_sow", { job_type: "plastering" });
    await modelCalls("finish_job");

    expect(sentPayloads()).toContain(CUSTOMER_NAME_QUESTION);
    expect(completions).toHaveLength(0);
  });

  it("does not ask when the name is already captured", async () => {
    // The other direction: the gate must not add a turn to a call that has
    // nothing outstanding.
    await startLiveCall(adapterReturning([NAME_CAPTURED]));
    await contractorSays("Reskim three rooms for Mrs Okafor, fixed at three fifty.");
    await modelCalls("update_sow", { customer_name: "Mrs Okafor" });
    await modelCalls("finish_job");

    expect(sentPayloads()).not.toContain(CUSTOMER_NAME_QUESTION);
    expect(completions).toHaveLength(1);
  });
});

describe("a call that ran its follow-ups and drained the queue", () => {
  beforeEach(() => {
    installWebrtcMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the name at the drain rather than finishing on the spot", async () => {
    // askNextQuestion's drain path: one slot open, so a follow-up runs; the
    // answer completes the checklist and the queue empties.
    await startLiveCall(adapterReturning([ONE_SLOT_OPEN, CHECKLIST_COMPLETE]));
    await contractorSays("Reskim three rooms, fixed at three fifty.");
    await modelCalls("update_sow", { job_type: "plastering" });
    await modelCalls("finish_job");

    // The follow-up for the open slot went out, and the name has NOT yet.
    expect(sentPayloads()).toContain("Who's supplying the materials");
    expect(sentPayloads()).not.toContain(CUSTOMER_NAME_QUESTION);

    // They answer it; the queue drains.
    await contractorSays("I'm supplying the plaster.");
    await modelCalls("update_sow", { materials_supply: { contractor_supplied: ["plaster"] } });

    expect(sentPayloads()).toContain(CUSTOMER_NAME_QUESTION);
    expect(completions).toHaveLength(0);
  });
});
