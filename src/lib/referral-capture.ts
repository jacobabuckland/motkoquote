// Holding a referral code between landing and signing up.
//
// The code used to be read once, at form-submit time, straight off
// `window.location.href`. That meant it survived exactly one page load of
// /signup and only if the referee submitted on that load. Three ordinary
// journeys lost it:
//
//   1. Tapping "Sign in" from the signup footer, realising they have no
//      account, and coming back — the return trip carries no ?ref=.
//   2. Installing the iOS app and creating the account there. The shell loads
//      https://motko.app (capacitor.config.ts, server.url), never the referral
//      URL, so the query string is not merely dropped — it never arrives.
//   3. Any reload, share, or redirect that trims the query.
//
// So the code is stashed the moment the referee LANDS, and read back at submit.
// localStorage rather than a cookie because the referrer's link is opened on
// the referee's own device and nothing server-side needs to see it before
// signup; sessionStorage would not survive the tab close in journey 2.
//
// Every accessor is wrapped: storage throws outright in a Safari private window
// and in some embedded web views, and losing a referral is much better than
// failing the signup form.

import { extractReferralCode } from "@/lib/referral";

export const REFERRAL_STORAGE_KEY = "motko.referral-code";

const safeStorage = (): Storage | null => {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Stores a normalized code. Silently no-ops on anything invalid. */
export const rememberReferralCode = (raw: string): string | null => {
  const code = extractReferralCode(raw);
  if (!code) return null;
  try {
    safeStorage()?.setItem(REFERRAL_STORAGE_KEY, code);
  } catch {
    // Quota, private mode, or a blocked web view. The in-memory value the
    // caller holds still works for this page load.
  }
  return code;
};

/** The code held from an earlier visit, or null. */
export const recallReferralCode = (): string | null => {
  try {
    const stored = safeStorage()?.getItem(REFERRAL_STORAGE_KEY);
    return stored ? extractReferralCode(stored) : null;
  } catch {
    return null;
  }
};

/**
 * Captures a code off the URL the referee arrived on and stashes it, falling
 * back to one held from an earlier visit.
 *
 * The URL wins when both are present: someone arriving on a fresh link is
 * redeeming that link, not an older one they never used.
 */
export const captureReferralCode = (href: string): string | null =>
  rememberReferralCode(href) ?? recallReferralCode();

/**
 * Clears the held code. Called once signup has consumed it, so a second person
 * signing up on the same device is not silently attributed to the first
 * person's referrer.
 */
export const forgetReferralCode = (): void => {
  try {
    safeStorage()?.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // Nothing to do — a stale code is redeemed at most once anyway, because
    // referrals.referee_contractor_id is unique.
  }
};
