// Pure referral helpers — no I/O, safe to unit test in isolation.
//
// A trade shares a short code (and a link that pre-fills it,
// `motko.app/join?ref=DAN4K2`). The code is the source of truth; the link is
// convenience. A referred trade who lands their first paid job unlocks +5 free
// jobs for the referrer — so the reward is real money's worth, and the guards
// below exist to stop a trade referring themselves.

import { normalizeUkPhone } from "@/lib/phone";

// Unambiguous alphabet — drops the letters I/O and digits 0/1 that get misread
// when a code is read aloud or typed off a screen. 32 chars, kept in sync with
// the SQL `gen_referral_code()` (migration 00000000000023_pricing_referral.sql),
// whose modulo depends on this exact length.
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LENGTH = 6;

// Generates a fresh code. `random` is injectable so tests are deterministic;
// production passes the default Math.random. Uniqueness is enforced at the DB
// (unique index) — callers retry on the rare collision.
export const generateReferralCode = (random: () => number = Math.random): string => {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    const index = Math.floor(random() * REFERRAL_CODE_ALPHABET.length);
    code += REFERRAL_CODE_ALPHABET.charAt(index);
  }
  return code;
};

// Normalizes a code a trade typed in: upper-cases, drops spaces/hyphens, and
// validates length + charset. Returns the canonical code, or null if it can't
// be a valid one (so redemption fails cleanly rather than matching nothing).
export const normalizeReferralCode = (input: string): string | null => {
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, "");
  if (cleaned.length !== REFERRAL_CODE_LENGTH) return null;
  for (const char of cleaned) {
    if (!REFERRAL_CODE_ALPHABET.includes(char)) return null;
  }
  return cleaned;
};

// Pulls a code out of whatever the referee arrived with — a bare code, or the
// share link's `?ref=` query. Sidesteps deferred deep-linking: the code always
// wins, the link is just a carrier.
export const extractReferralCode = (input: string): string | null => {
  const trimmed = input.trim();
  const refMatch = trimmed.match(/[?&]ref=([^&\s]+)/i);
  const candidate = refMatch?.[1] ?? trimmed;
  let decoded = candidate;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    // Malformed percent-encoding — fall back to the raw candidate.
  }
  return normalizeReferralCode(decoded);
};

// The identity fields we compare to detect a self-referral. All optional —
// a signal only fires when both sides supply the same field and it matches
// after normalization.
export type ReferralIdentity = {
  email?: string | null;
  phone?: string | null;
  // Trade's payout bank account (sort code + account number, or a provider
  // payee token) — same account on both sides is a strong self-referral tell.
  bankAccount?: string | null;
};

export type SelfReferralSignal = "email" | "phone" | "bank_account";

const normalizeEmail = (value: string): string => value.trim().toLowerCase();
const normalizeBankAccount = (value: string): string => value.replace(/\D/g, "");

// Returns every identity field that matches between referrer and referee.
// Empty array means no self-referral signal detected.
export const selfReferralSignals = (
  referrer: ReferralIdentity,
  referee: ReferralIdentity,
): SelfReferralSignal[] => {
  const signals: SelfReferralSignal[] = [];

  const referrerEmail = referrer.email ? normalizeEmail(referrer.email) : "";
  const refereeEmail = referee.email ? normalizeEmail(referee.email) : "";
  if (referrerEmail && referrerEmail === refereeEmail) signals.push("email");

  const referrerPhone = referrer.phone ? normalizeUkPhone(referrer.phone) : null;
  const refereePhone = referee.phone ? normalizeUkPhone(referee.phone) : null;
  if (referrerPhone && referrerPhone === refereePhone) signals.push("phone");

  const referrerBank = referrer.bankAccount ? normalizeBankAccount(referrer.bankAccount) : "";
  const refereeBank = referee.bankAccount ? normalizeBankAccount(referee.bankAccount) : "";
  if (referrerBank && referrerBank === refereeBank) signals.push("bank_account");

  return signals;
};

// A referral reward is blocked when referrer and referee share any identity.
export const isSelfReferral = (
  referrer: ReferralIdentity,
  referee: ReferralIdentity,
): boolean => selfReferralSignals(referrer, referee).length > 0;
