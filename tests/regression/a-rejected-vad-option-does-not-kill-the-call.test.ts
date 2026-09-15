/**
 * Asking for patient turn detection must never cost a contractor their call.
 *
 * semantic_vad's default eagerness treats a breath between clauses as the end
 * of a turn. A trade dictating a job pauses constantly, so the assistant barges
 * in — and the half-duplex mic gate closes the mic while it speaks, so the next
 * sentence is not merely ignored, it is never captured. Voice runs 08 and 09 on
 * 15 Sep lost 12.1s and 27.1s of speech that way, taking a door dimension, a
 * returns area and a whole revised crew allowance with them.
 *
 * `eagerness: "low"` is the fix, and it could not be verified against the
 * Realtime API from the environment that wrote it. A session that fails to mint
 * is a contractor who cannot start a call at all, so a 400 falls back to the
 * shape that has always worked.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// tests/setup.ts mocks this module for the whole suite, because nothing else
// wants to mint a real token. This file is about the module itself.
vi.unmock("@/lib/realtime");

const realtime = async () => (await import("@/lib/realtime")).createRealtimeClientSecret;

const config = { instructions: "be helpful", tools: [] };

const bodyOf = (call: unknown[]): Record<string, never> =>
  JSON.parse((call[1] as { body: string }).body);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const stubFetch = (...responses: { status: number; ok: boolean }[]) => {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift()!;
    return {
      ...next,
      json: async () => ({ value: "ek_test" }),
      text: async () => "rejected",
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("patient turn detection", () => {
  it("asks for it", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = stubFetch({ status: 200, ok: true });

    await (await realtime())(config);

    const sent = bodyOf(fetchMock.mock.calls[0] as unknown[]) as unknown as {
      session: { audio: { input: { turn_detection: { type: string; eagerness?: string } } } };
    };
    expect(sent.session.audio.input.turn_detection).toEqual({
      type: "semantic_vad",
      eagerness: "low",
    });
  });

  it("falls back to a plain session when the option is rejected", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = stubFetch({ status: 400, ok: false }, { status: 200, ok: true });

    // The call still succeeds. That is the whole point.
    await expect((await realtime())(config)).resolves.toBe("ek_test");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retried = bodyOf(fetchMock.mock.calls[1] as unknown[]) as unknown as {
      session: { audio: { input: { turn_detection: { type: string; eagerness?: string } } } };
    };
    expect(retried.session.audio.input.turn_detection).toEqual({ type: "semantic_vad" });

    warn.mockRestore();
  });

  it("does not retry a failure that is not the option being rejected", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = stubFetch({ status: 401, ok: false });

    await expect((await realtime())(config)).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
