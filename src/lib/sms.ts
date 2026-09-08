// Twilio's REST API called directly via fetch — no SDK dependency, mirrors
// the graceful-degradation pattern in email.ts: missing credentials means
// "can't send", not a thrown error, so the caller can fall back to a
// copyable link.
import { formatGBP } from "@/lib/format";
import { formatMessageAmount } from "@/lib/money-label";
import { chaseSmsLinkLabel } from "@/lib/chase-cta";

// Composes a message from the parts that are present, one per line.
//
// Every body used to end `…{url}. Reply STOP to opt out.` — a full stop against
// the last character of a URL. THE ORIGINAL THEORY FOR THAT BEING A PROBLEM WAS
// WRONG: a broken quote link on 8 Sep was blamed on it and the production logs
// refuted it, the real cause being an unguarded notification throwing after the
// write had committed (P0-2). Nothing here fixes an observed break and it must
// not be cited as evidence of one. It is still worth removing — handset and
// carrier link detection is not something this codebase controls or can test, a
// link is the entire point of the message, and a line break costs nothing.
//
// The second reason is measurable rather than speculative. Every body carried
// an em dash, which is NOT in the GSM-7 alphabet, and one such character forces
// the whole message to UCS-2 — halving the segment size from 160 characters to
// 70. These messages were being split and billed roughly twice over for a dash.
//
// The bodies stay composed inside each sender rather than moving to exported
// builders, which is where this started: tests/acceptance/lifecycle-send-dispatcher.ts
// reads THIS file and slices each sender from its declaration to its return
// looking for the STOP line, and it is frozen. Extracting the literal broke it.
// The assertions on these bodies therefore go through the wire — see
// tests/regression/sms-link-ends-its-line.test.ts, which stubs fetch and reads
// the Body parameter actually posted to Twilio, which is a better check anyway.
const smsLines = (...parts: (string | null | undefined)[]): string =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join("\n");

type SendQuoteSmsInput = {
  to: string; // E.164, e.g. +447123456789 — see lib/phone.ts
  companyName: string;
  total: number;
  // Whether the figure carries VAT, so the message can say so. `total` is the
  // VAT-inclusive figure either way; this only decides the label. Optional, and
  // absence means NO label — see the note on SendQuoteEmailInput.
  vatRegistered?: boolean;
  quoteUrl: string;
};

export const sendQuoteSms = async (
  input: SendQuoteSmsInput,
): Promise<{ delivered: boolean }> => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    // No Twilio credentials configured — caller falls back to a copyable link.
    return { delivered: false };
  }

  // Transactional only: identifies the sending business, states the reason
  // for contact, and includes an opt-out instruction, per UK PECR guidance
  // for one-off transactional messages.
  const body = smsLines(
    `${input.companyName}: your quote for ${formatMessageAmount(input.total, input.vatRegistered)} is ready.`,
    input.quoteUrl,
    `Reply STOP to opt out.`,
  );

  const params = new URLSearchParams({
    To: input.to,
    From: fromNumber,
    Body: body,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );

  if (!response.ok) {
    console.error("sendQuoteSms failed:", await response.text());
    return { delivered: false };
  }

  return { delivered: true };
};

type SendChaseSmsInput = {
  to: string; // E.164, e.g. +447123456789 — see lib/phone.ts
  companyName: string;
  body: string; // the chase copy, already drafted (see lib/chase.ts)
  paymentUrl: string | null;
  // Whether the one-tap pay-by-bank rails are live. Drives the link label only
  // (the URL is unchanged): "Pay: <url>" when true, "Invoice: <url>" when the
  // link goes to the manual bank-transfer fallback — never promising one-tap pay.
  payEnabled: boolean;
};

// Overdue-payment reminder over SMS. Mirrors sendQuoteSms: missing Twilio
// credentials means "can't send", not a thrown error. The chase body is drafted
// upstream; we append the pay link (if any) and a STOP opt-out line so every
// message stays PECR-compliant on its own.
export const sendChaseSms = async (
  input: SendChaseSmsInput,
): Promise<{ delivered: boolean }> => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return { delivered: false };
  }

  const body = smsLines(
    `${input.companyName}: ${input.body}`,
    // The one message where the URL is not alone on its line: it follows its
    // call-to-action label. That is fine — what matters is that the URL is
    // LAST on the line, not that it is alone.
    input.paymentUrl ? `${chaseSmsLinkLabel(input.payEnabled)}: ${input.paymentUrl}` : null,
    `Reply STOP to opt out.`,
  );

  const params = new URLSearchParams({
    To: input.to,
    From: fromNumber,
    Body: body,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );

  if (!response.ok) {
    console.error("sendChaseSms failed:", await response.text());
    return { delivered: false };
  }

  return { delivered: true };
};

// ---------------------------------------------------------------------------
// Contract and invoice SMS.
//
// These did not exist. src/lib/sms.ts exported a quote sender and a chase
// sender, so the two lifecycle steps in between — the contract that needs a
// signature and the invoice that needs money — had no SMS path at all. A
// customer who gave a phone number and no email received the quote and then
// silence, which customerInputSchema explicitly permits.
//
// Both mirror sendQuoteSms exactly: missing Twilio credentials mean "can't
// send" rather than a thrown error, so the caller can fall back to a copyable
// link, and every body carries the STOP opt-out line UK PECR requires of a
// one-off transactional message.
// ---------------------------------------------------------------------------

type SendContractSmsInput = {
  to: string; // E.164 — see lib/phone.ts
  companyName: string;
  contractUrl: string;
};

export const sendContractSms = async (
  input: SendContractSmsInput,
): Promise<{ delivered: boolean }> => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return { delivered: false };
  }

  const body = smsLines(
    `${input.companyName}: your contract is ready to sign.`,
    input.contractUrl,
    `Reply STOP to opt out.`,
  );

  return postTwilioMessage({ accountSid, authToken, fromNumber, to: input.to, body }, "sendContractSms");
};

type SendInvoiceSmsInput = {
  to: string; // E.164 — see lib/phone.ts
  companyName: string;
  amount: number;
  invoiceType: "deposit" | "final";
  paymentUrl: string;
};

export const sendInvoiceSms = async (
  input: SendInvoiceSmsInput,
): Promise<{ delivered: boolean }> => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    return { delivered: false };
  }

  const label = input.invoiceType === "deposit" ? "deposit invoice" : "invoice";
  const body = smsLines(
    `${input.companyName}: your ${label} for ${formatGBP(input.amount)} is ready.`,
    input.paymentUrl,
    `Reply STOP to opt out.`,
  );

  return postTwilioMessage({ accountSid, authToken, fromNumber, to: input.to, body }, "sendInvoiceSms");
};

// The one place the Twilio REST call is made for the two senders above. Kept
// private: sendQuoteSms and sendChaseSms predate it and are left untouched
// rather than refactored inside a ticket about lifecycle fan-out.
const postTwilioMessage = async (
  args: { accountSid: string; authToken: string; fromNumber: string; to: string; body: string },
  label: string,
): Promise<{ delivered: boolean }> => {
  const params = new URLSearchParams({ To: args.to, From: args.fromNumber, Body: args.body });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${args.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${args.accountSid}:${args.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );

  if (!response.ok) {
    console.error(`${label} failed:`, await response.text());
    return { delivered: false };
  }

  return { delivered: true };
};
