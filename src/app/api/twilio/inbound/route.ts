import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeUkPhone } from "@/lib/phone";
import { parseSmsCommand, validateTwilioSignature } from "@/lib/twilio";

// Empty TwiML — acknowledges the message without sending an auto-reply (Twilio
// already sends its own STOP/START confirmation when messaging from a plain
// number). Returned for every request so we never leak whether we acted.
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
const twiml = () =>
  new NextResponse(EMPTY_TWIML, { status: 200, headers: { "Content-Type": "text/xml" } });

// Inbound SMS webhook. Twilio POSTs form-encoded here when a customer replies.
// We only act on STOP/START keywords, mirroring the opt-out into our own DB so
// the chase cron and quote-send flow stop (or resume) texting that number.
// Opt-out is global-by-number: one person may be a customer of several
// tradespeople, and a STOP means "stop texting me", full stop.
export const POST = async (request: NextRequest) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return NextResponse.json({ error: "Twilio not configured" }, { status: 503 });

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  // Twilio signs the exact URL it was configured with. Build it from our public
  // base rather than request.url, whose host is the internal proxy target.
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/twilio/inbound`;
  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!validateTwilioSignature(authToken, url, params, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const command = parseSmsCommand(params.Body ?? "");
  const from = normalizeUkPhone(params.From ?? "");
  if (!command || !from) return twiml();

  const admin = createAdminClient();
  const { data: matches } = await admin
    .from("customers")
    .select("id, contact")
    .eq("contact->>phone", from);

  const optOut = command === "stop";
  for (const row of matches ?? []) {
    const contact = (row.contact ?? {}) as Record<string, unknown>;
    await admin
      .from("customers")
      .update({ contact: { ...contact, sms_opt_out: optOut } })
      .eq("id", row.id);
  }

  return twiml();
};
