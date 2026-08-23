import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SUPPORT_MESSAGE_MAX,
  SUPPORT_SUBJECT_MAX,
  supportMessageSchema,
} from "@/lib/schemas/support";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("the support message contract", () => {
  it("accepts an ordinary message", () => {
    const parsed = supportMessageSchema.safeParse({
      subject: "Invoice not showing as paid",
      message: "A customer paid on Tuesday and the job still shows as unpaid.",
    });
    expect(parsed.success).toBe(true);
  });

  it("trims, so whitespace is not a message", () => {
    expect(supportMessageSchema.safeParse({ subject: "   ", message: "   " }).success).toBe(
      false,
    );
  });

  // Both fields reach an email and the subject reaches a HEADER, so an
  // unbounded field is an unbounded header.
  it("bounds both fields", () => {
    expect(
      supportMessageSchema.safeParse({
        subject: "x".repeat(SUPPORT_SUBJECT_MAX + 1),
        message: "a real message, long enough",
      }).success,
    ).toBe(false);

    expect(
      supportMessageSchema.safeParse({
        subject: "fine",
        message: "x".repeat(SUPPORT_MESSAGE_MAX + 1),
      }).success,
    ).toBe(false);
  });

  it("refuses a message too short to act on", () => {
    expect(supportMessageSchema.safeParse({ subject: "help", message: "help" }).success).toBe(
      false,
    );
  });
});

describe("what the sender does with it", () => {
  const email = read("src/lib/email.ts");
  const sender = email.slice(email.indexOf("export const sendSupportEmail"));

  it("goes to the support inbox", () => {
    expect(email).toContain('export const SUPPORT_INBOX = "hello@motko.app"');
    expect(sender).toContain("to: SUPPORT_INBOX");
  });

  // Without replyTo, answering the mail answers the sending domain and someone
  // has to copy the address out of the body by hand — which is how a support
  // inbox quietly stops being used.
  it("sets replyTo so a reply reaches the person", () => {
    expect(sender).toContain("replyTo: input.fromEmail");
  });

  it("sanitises the subject and escapes the body", () => {
    expect(sender, "the subject is a mail header").toContain("sanitizeEmailSubject(input.subject)");
    expect(sender, "the message is user input in HTML").toContain("escapeHtml(input.message)");
  });

  it("reports non-delivery rather than claiming it sent", () => {
    expect(sender).toContain("return { delivered: false }");
  });
});

describe("the server action", () => {
  const action = read("src/app/settings/support/support-actions.ts");

  it("takes the identity from the session, never from the form", () => {
    expect(action).toContain("supabase.auth.getUser()");
    expect(action).toContain("fromEmail: user.email");
    expect(action, "a form field claiming to be a contractor id is worth nothing").not.toMatch(
      /fromEmail:\s*(raw|parsed)/,
    );
  });

  it("re-validates server-side", () => {
    expect(action).toContain("supportMessageSchema.safeParse(raw)");
  });

  it("refuses when signed out", () => {
    expect(action).toContain('return { error: "Not signed in." }');
  });

  // A form that reports success when nothing was sent leaves someone waiting
  // for a reply that cannot come.
  it("surfaces a failed send, and names the fallback address", () => {
    const tail = action.slice(action.indexOf("if (!delivered)"));
    expect(tail).toContain("hello@motko.app");
  });
});

/**
 * `/support` is the PUBLIC page the App Store submission points at, and
 * middleware treats everything under it as public. I overwrote it while
 * building this, which would have replaced the App Store's support URL with a
 * page that redirects to /login.
 *
 * These bind the separation so the next person cannot make the same mistake
 * quietly.
 */
describe("the public support page is not the in-app form", () => {
  it("keeps the public page public and unauthenticated", () => {
    const page = read("src/app/support/page.tsx");
    expect(page, "it is the App Store support URL").toContain("export const metadata");
    expect(page, "must not gate the App Store's support URL behind a login").not.toContain(
      "redirect(\"/login\")",
    );
  });

  it("puts the capture behind auth, outside the public prefix", () => {
    const page = read("src/app/settings/support/page.tsx");
    expect(page).toContain('redirect("/login")');

    const middleware = read("src/lib/supabase/middleware.ts");
    expect(middleware, "/support is public by prefix").toContain(
      'pathname.startsWith("/support")',
    );
    expect(
      middleware.includes('startsWith("/settings")'),
      "/settings must NOT be public, or the capture endpoint is exposed",
    ).toBe(false);
  });

  // Both surfaces name the same inbox. They drifted once already — the public
  // page said support@ while the form sent to hello@ — and a contact address
  // that disagrees with where the mail actually goes is the kind of thing
  // nobody notices until someone's message goes unanswered.
  it("names the same inbox everywhere a person is told where to write", () => {
    // Every surface that gives a human an address to contact. The privacy
    // page is the one that matters most: it is the contact for data and
    // deletion requests, so an address there that nobody reads is a
    // compliance problem rather than a cosmetic one.
    for (const file of [
      "src/app/support/page.tsx",
      "src/app/privacy/page.tsx",
    ]) {
      const page = read(file);
      expect(page, file).toContain("hello@motko.app");
      expect(page, `${file} still names the old address`).not.toContain(
        "support@motko.app",
      );
    }
  });

  it("links Settings at the authenticated route", () => {
    const section = read("src/app/settings/support-section.tsx");
    expect(section).toContain('href="/settings/support"');
    expect(section).not.toContain('href="/support"');
  });
});
