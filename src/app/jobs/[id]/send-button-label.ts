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
};

export const SEND_LABEL = {
  idle: "Send quote",
  sending: "Sending...",
  sent: "Sent ✓",
} as const;

export const sendButtonLabel = ({ sent, isSending }: SendButtonState): string => {
  if (sent) return SEND_LABEL.sent;
  if (isSending) return SEND_LABEL.sending;
  return SEND_LABEL.idle;
};
