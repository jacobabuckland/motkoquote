// Pure helpers for the inbound Twilio webhook — no network I/O, safe to unit
// test in isolation. The route that uses these reads env + database; these two
// functions are the security-critical (signature) and semantic (keyword)
// pieces, kept pure so they can be asserted directly.
import { createHmac, timingSafeEqual } from "node:crypto";

// Twilio signs each request with HMAC-SHA1 over the full request URL followed
// by every POST parameter sorted by key and concatenated as key+value, then
// base64-encoded. We recompute it with the auth token and compare in constant
// time. See https://www.twilio.com/docs/usage/security#validating-requests
export const validateTwilioSignature = (
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean => {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");

  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
};

export type SmsCommand = "stop" | "start" | null;

// Twilio's standard opt-out / opt-in keywords. STOP (and friends) sets the
// customer to opted-out; START/UNSTOP/YES resubscribes. Anything else is a
// normal reply we don't act on. Case-insensitive, whitespace-trimmed.
const STOP_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"]);
const START_KEYWORDS = new Set(["start", "unstop", "yes"]);

export const parseSmsCommand = (body: string): SmsCommand => {
  const word = body.trim().toLowerCase();
  if (STOP_KEYWORDS.has(word)) return "stop";
  if (START_KEYWORDS.has(word)) return "start";
  return null;
};
