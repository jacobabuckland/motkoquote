// Customer details as they arrive from a text or a call, and errors as the
// contractor should read them.
//
// WHY THIS EXISTS. A contractor typed "quote Dave, dave@example.com" and the
// send failed with a wall of JSON. Two things had gone wrong at once:
//
//   1. What was stored was not what was meant. A dictated or typed email picks
//      up a space ("dave @example.com") or the full stop that ends the
//      sentence ("dave@example.com."). Nothing cleaned it on the way in, and
//      nothing checked it before the Send button was offered.
//   2. The real send validates the email with zod, which throws a ZodError whose
//      message is a JSON dump of the issues. The gate caught it and printed it.
//
// So: clean the address where it enters, check it with the SAME rule the real
// send uses (customerInputSchema) before offering Send, and never let a raw
// error reach a contractor.

import { z } from "zod";
import { sanitiseForModel } from "./data";

/**
 * Tidies an email the way a person would when reading it back: no stray spaces,
 * no angle brackets or quotes around it, no "mailto:", and no sentence
 * punctuation trailing off the end. It never invents or rewrites characters
 * inside the address, so a genuinely wrong address stays wrong and is reported.
 */
export const cleanEmail = (raw: string | null | undefined): string | undefined => {
  if (raw === null || raw === undefined) return undefined;
  let value = String(raw).trim();
  value = value.replace(/^mailto:/i, "");
  value = value.replace(/^[<("'`]+/, "").replace(/[>)"'`]+$/, "");
  value = value.replace(/\s+/g, "");
  value = value.replace(/[.,;:!?]+$/, "");
  return value.length > 0 ? value : undefined;
};

// The same rule customerInputSchema applies at send time, so the card and the
// real send can never disagree about whether an address is acceptable.
const emailRule = z.string().trim().email();

export const isValidEmail = (email: string | undefined): email is string =>
  email !== undefined && emailRule.safeParse(email).success;

/** The blocker shown on a card for an address that won't pass. */
export const emailBlocker = (raw: string): string =>
  `The email address "${sanitiseForModel(raw, 60)}" doesn't look right. Tell me the right one.`;

// ---------------------------------------------------------------------------
// Errors in words
// ---------------------------------------------------------------------------

type Issue = { path?: unknown; code?: unknown };

const issuesOf = (error: unknown): Issue[] | null => {
  if (typeof error === "object" && error !== null && "issues" in error) {
    const issues = (error as { issues: unknown }).issues;
    if (Array.isArray(issues)) return issues as Issue[];
  }
  if (error instanceof Error) {
    // A ZodError that crossed a boundary arrives as a string of its issues.
    const text = error.message.trim();
    if (text.startsWith("[") || text.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed as Issue[];
      } catch {
        // Not JSON after all. Fall through to the generic handling.
      }
    }
  }
  return null;
};

const mentions = (issues: Issue[], field: string): boolean =>
  issues.some((issue) => Array.isArray(issue.path) && issue.path.includes(field));

const looksMachineMade = (text: string): boolean =>
  text.length > 160 ||
  /^[[{]/.test(text) ||
  /"(code|path|origin|issues)"/.test(text) ||
  /\n\s+at\s/.test(text) ||
  /\b(ZodError|TypeError|ReferenceError|SyntaxError)\b/.test(text);

/**
 * One plain sentence for whatever went wrong. Validation failures are named by
 * the field; short human-written messages (the app's own actionable errors) are
 * kept; anything that looks like a dump gets a generic line instead. Never
 * returns raw JSON, a stack trace or a long string.
 */
export const describeActionError = (error: unknown): string => {
  const issues = issuesOf(error);
  if (issues) {
    if (mentions(issues, "email")) return "That email address doesn't look right.";
    if (mentions(issues, "phone")) return "That mobile number doesn't look right.";
    if (mentions(issues, "name")) return "I'm missing the customer's name.";
    return "Some of the details didn't pass the checks.";
  }
  if (error instanceof Error) {
    const text = error.message.replace(/\s+/g, " ").trim();
    if (text && !looksMachineMade(text)) return /[.!?]$/.test(text) ? text : `${text}.`;
  }
  return "Something went wrong on our side.";
};
