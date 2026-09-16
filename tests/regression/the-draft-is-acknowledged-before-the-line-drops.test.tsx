/**
 * @vitest-environment happy-dom
 */

/**
 * A voice cost capture answers the model before it hangs up.
 *
 * `handleToolCall`'s success branch ran in this order:
 *
 *   cleanup();          // closes the RTCDataChannel
 *   dc.send(function_call_output { success: true });
 *
 * Sending on a channel that is not open throws `InvalidStateError`, so the send
 * threw on EVERY successful capture. The surrounding catch then sent its error
 * output on the same closed channel and threw again — out of the message
 * handler this time, uncaught. So the one path that always runs was the one
 * that always crashed, and the model was never told its own tool call had
 * worked.
 *
 * `job-intake.tsx` had already fixed this, with a `sendToolAck` that checks
 * `readyState` and an ack sent before the call concludes. Cost capture never
 * got it. Both senders here now check, and the acknowledgement goes out first.
 *
 * The fake channel's `close()` really does set `readyState` to "closed". That
 * is the whole test: a stub that closes without closing would let the defect
 * through, because the send it swallows is exactly the one that throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CostIntake } from "@/components/voice/cost-intake";
import type { CostIntakeAdapter, DraftedCost } from "@/components/voice/cost-intake-adapter";

afterEach(cleanup);

type FakeChannel = {
  readyState: string;
  send: ReturnType<typeof vi.fn>;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  close: () => void;
};

let channel: FakeChannel;
let completions: DraftedCost[];

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
      const ch: FakeChannel = {
        readyState: "open",
        // A REAL RTCDataChannel throws here once it is closed. Anything gentler
        // and this file cannot see the bug it exists for.
        send: vi.fn((..._args: unknown[]) => {
          if (ch.readyState !== "open") {
            throw new DOMException("readyState not 'open'", "InvalidStateError");
          }
        }),
        onopen: null,
        onmessage: null,
        close: () => {
          ch.readyState = "closed";
        },
      };
      channel = ch;
      return ch;
    });
  }
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);

  class FakeAudioContext {
    currentTime = 0;
    destination = {};
    createMediaStreamSource = () => ({ connect: () => {} });
    createAnalyser = () => ({
      fftSize: 512,
      frequencyBinCount: 256,
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

const adapter: CostIntakeAdapter = {
  startSession: async () => ({
    sessionKey: null,
    clientSecret: "ephemeral",
    jobs: [{ id: "job_1", customer_name: "Henderson", created_at: "2026-09-01T00:00:00Z" }],
  }),
  complete: async (draft) => {
    completions.push(draft);
  },
  backHref: "/costs",
  backLabel: "Back",
};

const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
};

const startLiveCall = async () => {
  render(<CostIntake adapter={adapter} />);
  fireEvent.click(screen.getByRole("button", { name: /Start recording/i }));
  await settle();
  await act(async () => {
    channel.onopen?.();
  });
};

const draftCostToolCall = async (args: Record<string, unknown>) => {
  await act(async () => {
    channel.onmessage?.({
      data: JSON.stringify({
        type: "response.function_call_arguments.done",
        name: "draft_cost",
        call_id: "call_1",
        arguments: JSON.stringify(args),
      }),
    });
  });
  await settle();
};

const GOOD_ARGS = {
  amount_words: "two hundred and eighty pounds",
  amount_basis: "gross",
  vat_treatment: "standard",
  counterparty_name: "Screwfix",
  category: "materials",
  job_spoken_words: "the Henderson job",
  description: "Materials from Screwfix",
};

/**
 * Every frame that actually WENT OUT, parsed.
 *
 * Filtered on the send returning rather than throwing. `mock.calls` records the
 * attempt either way, so counting calls would have scored the defect's throwing
 * send as a delivered acknowledgement — which is precisely the thing under test.
 */
type Frame = { type: string; item?: { type: string; call_id: string; output: string } };

const sentFrames = (): Frame[] =>
  channel.send.mock.calls
    .filter((_call, i) => channel.send.mock.results[i]?.type === "return")
    .map((call) => JSON.parse(String(call[0])) as Frame);

describe("a cost the contractor captured", () => {
  beforeEach(installWebrtcMocks);

  it("acknowledges the tool call while the channel is still open", async () => {
    await startLiveCall();
    await draftCostToolCall(GOOD_ARGS);

    const outputs = sentFrames().filter((f) => f.item?.type === "function_call_output");

    expect(outputs, "the model is never told its own tool call succeeded").toHaveLength(1);
    expect(outputs[0]?.item?.call_id).toBe("call_1");
    expect(JSON.parse(outputs[0]!.item!.output) as { success: boolean }).toEqual({ success: true });
  });

  it("never throws by sending down a line it has already dropped", async () => {
    await startLiveCall();
    await draftCostToolCall(GOOD_ARGS);

    // Sending after close is what threw, twice: once in the success branch and
    // again in the catch that tried to report it.
    for (const call of channel.send.mock.results) {
      expect(call.type, "a send was attempted on a closed channel").toBe("return");
    }
  });

  it("still hangs up, and shows the draft for confirmation", async () => {
    await startLiveCall();
    await draftCostToolCall(GOOD_ARGS);

    expect(channel.readyState).toBe("closed");
    expect(screen.getAllByText(/Screwfix/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Confirm and save/i })).toBeDefined();
  });
});

describe("a cost the matcher could not place", () => {
  beforeEach(installWebrtcMocks);

  it("reports the reason and leaves the call up to ask", async () => {
    await startLiveCall();
    await draftCostToolCall({ ...GOOD_ARGS, job_spoken_words: "the job I did last week" });

    const outputs = sentFrames().filter((f) => f.item?.type === "function_call_output");
    const output = JSON.parse(outputs[0]!.item!.output) as { success: boolean; error?: string };

    expect(output.success).toBe(false);
    expect(output.error).toBeTruthy();
    // The channel stays open — there is a question still to put.
    expect(channel.readyState).toBe("open");
    expect(sentFrames().some((f) => f.type === "response.create")).toBe(true);
  });
});
