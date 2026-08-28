// The send button's label as a pure function of the two send states, extracted
// so the state machine is unit-testable without a DOM harness.
//
// The invariant that matters: the button must never terminally rest on
// "Sending…". `sent` (a delivered send) takes precedence over the pending
// spinner, so once a send lands the label reads "Sent ✓" while the client
// navigates away — and every non-pending state resolves to a terminal label
// ("Send quote" or "Sent ✓"), never "Sending…".

export type SendButtonState = {
  sent: boolean;
  isSending: boolean;
  /**
   * The quote has already been delivered once, so this control re-sends rather
   * than sends. Optional and defaulting to false: tests/acceptance/148.test.ts
   * is frozen and calls this with `{ sent, isSending }` only, so the field must
   * be addable without changing what those calls return (#370).
   */
  resend?: boolean;
};

export const SEND_LABEL = {
  idle: "Send quote",
  sending: "Sending...",
  sent: "Sent ✓",
  /**
   * Only the idle label changes for a re-send. "Sending…" and "Sent ✓" stay as
   * they are: mid-flight and terminal states describe what is happening to the
   * message, which is identical either way, and a second vocabulary for them
   * would be noise.
   */
  resendIdle: "Re-send to customer",
} as const;

export const sendButtonLabel = ({
  sent,
  isSending,
  resend = false,
}: SendButtonState): string => {
  if (sent) return SEND_LABEL.sent;
  if (isSending) return SEND_LABEL.sending;
  return resend ? SEND_LABEL.resendIdle : SEND_LABEL.idle;
};
