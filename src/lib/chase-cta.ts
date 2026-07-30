// The call-to-action wording for chase reminders, conditioned on whether the
// one-tap pay-by-bank rails are live. When they are, the link promises payment
// ("Pay now" / "Pay: <url>"). When they aren't (TrueLayer activation, or any
// rails outage) the link must NOT promise one-tap payment — it points at the
// same invoice page, which shows the manual bank-transfer details, so the copy
// reads as a view/reference link instead. The URL itself is unchanged either
// way; only the wording shifts. Pure so both the email and SMS paths share one
// source of truth and it stays unit-testable.

// Email link text (rendered as an <a> to paymentUrl).
export const chaseEmailLinkLabel = (payEnabled: boolean): string =>
  payEnabled ? "Pay now" : "View invoice";

// SMS label prefixing the URL, e.g. "Pay: https://…" vs "Invoice: https://…".
export const chaseSmsLinkLabel = (payEnabled: boolean): string =>
  payEnabled ? "Pay" : "Invoice";
