// Twilio's REST API called directly via fetch — no SDK dependency, mirrors
// the graceful-degradation pattern in email.ts: missing credentials means
// "can't send", not a thrown error, so the caller can fall back to a
// copyable link.
import { formatGBP } from "@/lib/format";

type SendQuoteSmsInput = {
  to: string; // E.164, e.g. +447123456789 — see lib/phone.ts
  companyName: string;
  total: number;
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
    `${input.companyName}: your quote for ${formatGBP(input.total)} is ready — ` +
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
