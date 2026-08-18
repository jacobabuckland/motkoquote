import { describe, expect, it } from "vitest";
import { micShouldBeEnabled } from "@/lib/voice-gate";

// Half-duplex gate: the mic is only live when the contractor isn't muted AND
// the assistant isn't speaking. Barge-in is explicitly unsupported — while the
// assistant speaks the mic is closed, which is what stops the on-device echo
// loop from being heard as a user turn.
describe("micShouldBeEnabled", () => {
  it("is live when listening and not muted", () => {
    expect(micShouldBeEnabled({ muted: false, assistantSpeaking: false })).toBe(true);
  });

  it("is closed while the assistant is speaking (no barge-in)", () => {
    expect(micShouldBeEnabled({ muted: false, assistantSpeaking: true })).toBe(false);
  });

  it("stays closed when muted, even while listening", () => {
    expect(micShouldBeEnabled({ muted: true, assistantSpeaking: false })).toBe(false);
  });

  it("stays closed when muted and the assistant is speaking", () => {
    expect(micShouldBeEnabled({ muted: true, assistantSpeaking: true })).toBe(false);
  });
});
