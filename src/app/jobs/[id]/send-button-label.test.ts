import { describe, expect, it } from "vitest";
import { SEND_LABEL, sendButtonLabel } from "./send-button-label";

describe("sendButtonLabel — the send button state machine", () => {
  it("reads 'Send quote' at rest", () => {
    expect(sendButtonLabel({ sent: false, isSending: false })).toBe(SEND_LABEL.idle);
  });

  it("reads 'Sending...' while a send is in flight", () => {
    expect(sendButtonLabel({ sent: false, isSending: true })).toBe(SEND_LABEL.sending);
  });

  it("flips to 'Sent ✓' on a delivered send", () => {
    expect(sendButtonLabel({ sent: true, isSending: false })).toBe(SEND_LABEL.sent);
  });

  it("shows 'Sent ✓' — not 'Sending...' — if navigation stalls with the send still pending", () => {
    // The delivered branch sets `sent` before router.push; if that navigation
    // hangs, `isSending` can still be true. `sent` must win so the button never
    // rests on the spinner.
    expect(sendButtonLabel({ sent: true, isSending: true })).toBe(SEND_LABEL.sent);
  });

  it("never terminally rests on 'Sending...' — every non-pending state is terminal", () => {
    // Enumerate the whole 2x2 state space: whenever a send is NOT in flight, the
    // label is one of the two terminal outcomes, never the spinner. This is the
    // guarantee behind the stuck-on-"Sending…" bug.
    for (const sent of [false, true]) {
      for (const isSending of [false, true]) {
        const label = sendButtonLabel({ sent, isSending });
        if (!isSending) {
          expect(label).not.toBe(SEND_LABEL.sending);
          expect([SEND_LABEL.idle, SEND_LABEL.sent]).toContain(label);
        }
      }
    }
  });
});
