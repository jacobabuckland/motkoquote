/**
 * Pure helpers for S3: what goes on the page, and what must never go on it.
 */

import { DIGEST_MAX_LINES } from "./config";

/**
 * Redact anything that looks like a credential.
 *
 * A hard constraint says no secrets in the digest, the run log or the snapshot;
 * preview URLs are fine, tokens and Account Links are not. The digest is
 * written by a model from event data, so "it will not include one" is not a
 * property anything guarantees — this is the thing that guarantees it.
 *
 * Deliberately over-broad. A redacted false positive is a line that reads
 * slightly worse; a missed true positive is a credential on a shared Notion
 * page, and the two costs are not comparable.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  // Notion, GitHub, Stripe, Supabase, Anthropic, Vercel token shapes.
  [/\bntn_[A-Za-z0-9]{20,}/g, "[redacted:notion-token]"],
  [/\bsecret_[A-Za-z0-9]{32,}/g, "[redacted:notion-token]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted:github-token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, "[redacted:github-token]"],
  [/\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/g, "[redacted:stripe-key]"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, "[redacted:anthropic-key]"],
  [/\bsbp_[A-Za-z0-9]{20,}/g, "[redacted:supabase-token]"],
  // A JWT — Supabase anon/service keys are JWTs and the service one is fatal.
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted:jwt]"],
  // Stripe Account Links and login links are single-use credentials in a URL.
  [/https:\/\/connect\.stripe\.com\/\S+/g, "[redacted:stripe-account-link]"],
  // Any URL carrying a token-ish query parameter.
  [/([?&](?:token|key|secret|access_token|api_key)=)[^&\s)]+/gi, "$1[redacted]"],
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

/**
 * §8's cap: 40 lines, and "Moved" is the only section that may be truncated.
 *
 * Decisions needed, Broken and Supervisor actions are each things someone has
 * to act on; Moved is context. Truncating by simply cutting at line 40 would
 * drop whichever section happened to sort last, which on a busy hour is the
 * actions list — the record of what the supervisor itself did.
 */
export function capDigest(digest: string, max = DIGEST_MAX_LINES): string {
  const lines = digest.split("\n");
  if (lines.length <= max) return digest;

  const movedStart = lines.findIndex((l) => /^#{1,6}\s*(\d\.\s*)?Moved\b/i.test(l.trim()));
  if (movedStart === -1) {
    // No Moved section to cut. Keep the head and say plainly what was lost,
    // rather than silently ending mid-sentence.
    return [...lines.slice(0, max - 1), `_…truncated, ${lines.length - max + 1} further lines_`].join("\n");
  }

  const movedEnd = lines.findIndex(
    (l, i) => i > movedStart && /^#{1,6}\s/.test(l.trim()),
  );
  const tail = movedEnd === -1 ? [] : lines.slice(movedEnd);
  const head = lines.slice(0, movedStart + 1);

  const budget = max - head.length - tail.length - 1;
  const moved = (movedEnd === -1 ? lines.slice(movedStart + 1) : lines.slice(movedStart + 1, movedEnd))
    .filter((l) => l.trim().length > 0);
  const kept = moved.slice(0, Math.max(budget, 0));
  const dropped = moved.length - kept.length;

  return [
    ...head,
    ...kept,
    dropped > 0 ? `_…and ${dropped} more transition${dropped === 1 ? "" : "s"}_` : "",
    ...tail,
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");
}

/** One run-log line, per §8. */
export function runLogLine(takenAt: string, events: number, actions: number): string {
  return `${takenAt} · ${events} event${events === 1 ? "" : "s"} · ${actions} action${actions === 1 ? "" : "s"}`;
}
