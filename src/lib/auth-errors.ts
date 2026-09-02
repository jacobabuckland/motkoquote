// Typed error codes for the auth surfaces (A6).
//
// Signup and sign-in both used to render `error.message` straight from
// Supabase: upstream English prose, unmapped and unswitchable, so nothing
// downstream could branch on WHICH failure had happened and nothing could be
// tested for beyond a string. The one hardcoded literal — the network fallback
// on /login — was worse still, because it flattened every thrown error into one
// sentence regardless of cause.
//
// This maps each distinct failure to a code of our own plus the sentence a
// contractor should read. The code is what callers branch and assert on; the
// message is what they show. Adding a case here is how a new failure mode gets
// handled, rather than by widening a string comparison at a call site.

import { isAuthError } from "@supabase/auth-js";

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "weak_password"
  | "email_invalid"
  | "rate_limited"
  | "otp_expired"
  | "otp_invalid"
  | "signup_disabled"
  | "user_banned"
  | "session_expired"
  | "network_unavailable"
  | "unknown";

export type MappedAuthError = {
  code: AuthErrorCode;
  message: string;
};

// One sentence per code, written for a tradesperson standing in a van with one
// bar of signal — what happened, and what to do about it.
const MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: "That email and password don't match. Check them and try again.",
  email_not_confirmed:
    "You haven't confirmed your email yet. Check your inbox for the link we sent.",
  weak_password: "That password is too easy to guess. Use at least 8 characters.",
  email_invalid: "That doesn't look like a valid email address.",
  rate_limited: "Too many attempts. Wait a minute or two, then try again.",
  otp_expired: "That code has expired. Ask for a new one and try again.",
  otp_invalid: "That code isn't right. Check it and try again.",
  signup_disabled: "New accounts are closed at the moment. Get in touch and we'll sort it.",
  user_banned: "This account has been suspended. Get in touch and we'll look into it.",
  session_expired: "You've been signed out. Sign in again to carry on.",
  network_unavailable: "We couldn't reach Motko. Check your signal and try again.",
  unknown: "Something went wrong. Try again, and get in touch if it keeps happening.",
};

// Supabase's own error codes, which are stable identifiers rather than prose.
// Anything not listed falls through to the status-code and message heuristics
// below rather than to `unknown` directly — a mapped code is worth more than a
// generic one even when the mapping is inferred.
const SUPABASE_CODES: Record<string, AuthErrorCode> = {
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  weak_password: "weak_password",
  validation_failed: "email_invalid",
  email_address_invalid: "email_invalid",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "rate_limited",
  otp_expired: "otp_expired",
  otp_disabled: "otp_invalid",
  signup_disabled: "signup_disabled",
  user_banned: "user_banned",
  session_expired: "session_expired",
  session_not_found: "session_expired",
  // NOT mapped on purpose: `email_exists` and `user_already_exists`. Surfacing
  // either would tell an unauthenticated stranger whether an address has an
  // account, which is the enumeration signal D8 forbids. Supabase does not
  // return them on the signup path for exactly that reason, and if one ever
  // does reach here it must present as `unknown`, not as "that's taken".
};

/**
 * Maps anything an auth call can fail with — a returned Supabase AuthError, a
 * thrown network error, an unrecognised value — onto one typed code and the
 * sentence to show for it.
 *
 * Never returns the upstream message. Passing Supabase's prose through is what
 * this replaces, and it leaks implementation detail as readily as it confuses.
 */
export const mapAuthError = (error: unknown): MappedAuthError => {
  // A fetch that never completed. On the iOS shell this is the common one — the
  // WKWebView loses the network mid-request — and it is not an auth failure at
  // all, so it must not read as "wrong password".
  if (isNetworkFailure(error)) return toMapped("network_unavailable");

  const { code, status, message } = describe(error);

  // Supabase's own code is the most reliable signal, and the only one that is
  // a stable identifier rather than prose.
  if (code && SUPABASE_CODES[code]) return toMapped(SUPABASE_CODES[code]);

  // It omits `code` on some responses, on anything raised before a response
  // arrives, and — the case that matters most in practice — on every
  // hand-rolled test double. Falling straight through to `unknown` there would
  // make a perfectly recognisable failure read as "something went wrong", so
  // status and message are consulted in turn.
  if (status === 429 || /rate limit|too many/i.test(message)) return toMapped("rate_limited");
  if (/token has expired|otp.*expired|code has expired/i.test(message)) {
    return toMapped("otp_expired");
  }
  if (/token.*invalid|invalid.*token|invalid.*code/i.test(message)) return toMapped("otp_invalid");
  if (/invalid login|invalid credential|wrong password/i.test(message)) {
    return toMapped("invalid_credentials");
  }
  if (/not confirmed|confirm your email/i.test(message)) return toMapped("email_not_confirmed");
  if (/password.*(short|weak)|weak password/i.test(message)) return toMapped("weak_password");
  if (/invalid.*email|email.*invalid/i.test(message)) return toMapped("email_invalid");

  return toMapped("unknown");
};

// Pulls the three fields worth branching on out of anything an auth call can
// hand back — a real AuthError, a thrown Error, or the plain `{ message }`
// object a test double returns.
const describe = (
  error: unknown,
): { code: string | undefined; status: number | undefined; message: string } => {
  if (isAuthError(error)) {
    return { code: error.code, status: error.status, message: error.message };
  }
  if (typeof error === "object" && error !== null) {
    const shape = error as { code?: unknown; status?: unknown; message?: unknown };
    return {
      code: typeof shape.code === "string" ? shape.code : undefined,
      status: typeof shape.status === "number" ? shape.status : undefined,
      message: typeof shape.message === "string" ? shape.message : "",
    };
  }
  return { code: undefined, status: undefined, message: "" };
};

const toMapped = (code: AuthErrorCode): MappedAuthError => ({
  code,
  message: MESSAGES[code],
});

// A TypeError from fetch is what a dead connection looks like in the browser;
// Supabase wraps some of them in AuthRetryableFetchError, which carries no
// status. Both mean the same thing to the person looking at the screen.
const isNetworkFailure = (error: unknown): boolean => {
  if (error instanceof TypeError) return true;
  if (isAuthError(error)) {
    return error.name === "AuthRetryableFetchError" || error.status === undefined;
  }
  return false;
};

export const authErrorMessage = (code: AuthErrorCode): string => MESSAGES[code];
