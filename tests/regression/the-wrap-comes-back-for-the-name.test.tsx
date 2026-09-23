/**
 * @vitest-environment happy-dom
 */

// Asking for the customer's name once is not the same as getting it.
//
// Reported 21 Sep, from a live call. The wrap detour put two questions in one
// breath, which is what it is designed to do:
//
//   "Just a couple of quick final questions: Has anything already been agreed
//    with the customer on cost — a day rate, a fixed price, or a deposit? And
//    who's this quote for — what's the customer's name?"
//
// The contractor answered the cost. The name was never put again, and the
// quote reached the editor with CUSTOMER blank.
//
// THE DETOUR'S OWN RULE IS WHY. buildCombinedWrapInstruction ends "don't push
// or re-ask; whatever's still unanswered is taken as an unknown", and that is
// correct for a scope slot: the contractor is trying to end the call, an
// unknown crew or unknown dates still price, and the job page flags them.
//
// The name is not one of those. The send is BLOCKED without it -- the intake
// prompt says so in as many words, exempting it from the question budget as
// "required to send the quote, not to price the job" -- so "taken as an
// unknown" is not an outcome it has. Bundled into the compact ask, it
// inherited the no-re-ask rule anyway.
//
// #714 made the detour carry the name and every-wrap-asks-the-customer-name
// pins that no exit skips ASKING it. This is the other half: one bounded
// return for the name alone, and the restraint around it -- not a loop, not a
// new question, and nothing at all when the contractor has gone quiet or has
// already given the name.

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

/** Every checklist slot answered, and no customer name — the reported shape. */
const NO_NAME: SowState = {
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
    deposit_pct: null,
    notes: undefined,
  },
  pricing: { mode: "fixed", fixed_amount: 350 },
};

/** The same call after the contractor finally gives the name. */
const NAME_GIVEN: SowState = { ...NO_NAME, customer_name: "Mrs Okafor" };

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
  await settle();
};

const sentPayloads = () =>
  channel.send.mock.calls.map((call) => String(call[0])).join("\n");

/** How many sends mention the name question. The compact ask is the first. */
const nameAsks = () =>
  channel.send.mock.calls.filter((call) =>
    String(call[0]).includes("the customer's name"),
  ).length;

/**
 * Runs a call to the end of its wrap detour: every slot answered but the name,
 * the model wraps, and the contractor takes both of the detour's turns without
 * ever giving it.
 */
const wrapWithoutGivingTheName = async (after: SowState = NO_NAME) => {
  await startLiveCall(adapterReturning([after]));
  await modelCalls("update_sow", { job_type: "plastering" });
  await modelCalls("finish_job");
  await contractorSays("Nothing agreed, no.");
  await contractorSays("That's everything, thanks.");
};

describe("a wrap whose compact ask got half an answer", () => {
  beforeEach(() => {
    installWebrtcMocks();
  });

  it("comes back for the name rather than drafting without it", async () => {
    await wrapWithoutGivingTheName();

    // Twice: the compact ask, then the name on its own.
    expect(nameAsks()).toBe(2);
    expect(sentPayloads()).toContain("They didn't give the customer's name");
  });

  it("asks for the name and nothing else", async () => {
    await wrapWithoutGivingTheName();

    const followUp = channel.send.mock.calls
      .map((call) => String(call[0]))
      .find((payload) => payload.includes("They didn't give the customer's name"))!;

    // Not a reopened conversation: no other slot rides along with it.
    expect(followUp).not.toContain("already been agreed");
    expect(followUp).not.toContain("on site");
    expect(followUp).toContain("nothing else");
  });

  it("does not ask a third time", async () => {
    await wrapWithoutGivingTheName();
    // Two more turns, still no name. The bound is a bound.
    await contractorSays("I'll get it to you later.");
    await contractorSays("Yeah, that's me done.");

    expect(nameAsks()).toBe(2);
  });

  it("still drafts, rather than holding the call open for a name", async () => {
    await wrapWithoutGivingTheName();
    await contractorSays("I'll get it to you later.");
    await contractorSays("Yeah, that's me done.");

    expect(completions).toHaveLength(1);
  });
});

describe("what it does not do", () => {
  beforeEach(() => {
    installWebrtcMocks();
  });

  it("does not come back when the contractor gave the name", async () => {
    // The compact ask goes out against a call with no name, and the name lands
    // in the same breath. Nothing is outstanding, so nothing is chased.
    await startLiveCall(adapterReturning([NO_NAME, NAME_GIVEN]));
    await modelCalls("update_sow", { job_type: "plastering" });
    await modelCalls("finish_job");
    await contractorSays("Nothing agreed. It's for Mrs Okafor.");
    await modelCalls("update_sow", { customer_name: "Mrs Okafor" });
    await contractorSays("That's everything.");

    expect(nameAsks()).toBe(1);
  });

  it("does not come back when the name was never part of the detour", async () => {
    // A call that already had the name: the compact ask never carried it, so
    // there is nothing for this to follow up on.
    await startLiveCall(adapterReturning([NAME_GIVEN]));
    await modelCalls("update_sow", { job_type: "plastering" });
    await modelCalls("finish_job");
    await contractorSays("Nothing agreed, no.");
    await contractorSays("That's everything.");

    expect(sentPayloads()).not.toContain("They didn't give the customer's name");
  });
});
