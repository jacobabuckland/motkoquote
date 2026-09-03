import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installClientLog, recentClientLog, resetClientLog } from "@/lib/client-log";

describe("client log buffer", () => {
  beforeEach(() => {
    resetClientLog();
    installClientLog();
  });

  afterEach(resetClientLog);

  it("keeps error and warn lines the console would otherwise throw away", () => {
    console.error("realtime disconnected", { code: 1006 });
    console.warn("retrying");

    expect(recentClientLog()).toEqual([
      '[error] realtime disconnected {"code":1006}',
      "[warn] retrying",
    ]);
  });

  it("keeps the most recent lines when the buffer overflows", () => {
    for (let i = 0; i < 40; i += 1) console.error(`line ${i}`);

    const lines = recentClientLog();
    expect(lines).toHaveLength(25);
    expect(lines[0]).toBe("[error] line 15");
    expect(lines.at(-1)).toBe("[error] line 39");
  });

  it("still calls the original console method", () => {
    // Re-install over a spy: installClientLog is idempotent, so this asserts
    // against the wrapper already in place from beforeEach.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    console.error("through");
    expect(spy).toHaveBeenCalledWith("through");
    spy.mockRestore();
  });

  it("does not double-record when installed twice", () => {
    installClientLog();
    installClientLog();

    console.error("once");

    expect(recentClientLog()).toEqual(["[error] once"]);
  });

  it("renders an Error by name and message rather than as an empty object", () => {
    console.error(new Error("boom"));

    expect(recentClientLog()).toEqual(["[error] Error: boom"]);
  });
});
