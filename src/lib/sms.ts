// Twilio's REST API called directly via fetch — no SDK dependency, mirrors
// the graceful-degradation pattern in email.ts: missing credentials means
// "can't send", not a thrown error, so the caller can fall back to a
// copyable link.
import { formatGBP } from "@/lib/format";
import { formatMessageAmount } from "@/lib/money-label";
import { chaseSmsLinkLabel } from "@/lib/chase-cta";

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
  const body =
    `${input.companyName}: your quote for ` +
    `${formatMessageAmount(input.total, input.vatRegistered)} is ready — ` +
    `${input.quoteUrl}. Reply STOP to opt out.`;

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

  const body =
    `${input.companyName}: ${input.body}` +
    (input.paymentUrl
      ? ` ${chaseSmsLinkLabel(input.payEnabled)}: ${input.paymentUrl}`
      : "") +
    ` Reply STOP to opt out.`;

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

  const body =
    `${input.companyName}: your contract is ready to sign — ` +
    `${input.contractUrl}. Reply STOP to opt out.`;

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
  const body =
    `${input.companyName}: your ${label} for ${formatGBP(input.amount)} is ready — ` +
    `${input.paymentUrl}. Reply STOP to opt out.`;

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
