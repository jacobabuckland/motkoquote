import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { runIdFromUrl, scrubEvent } from "@/lib/sentry-scrub";

// OBS-5's criterion: no customer name, address, phone number, email or payment
// detail is sent to Sentry.
//
// These assert the STRUCTURAL layer, because that is the one that holds. A
// customer's name is an ordinary word and no pattern matches it, so the tests
// that matter are the ones proving the carriers are gone — request bodies,
// cookies, headers, breadcrumb payloads — rather than the ones proving a phone
// number was rewritten.

const JOB_ID = "6c321285-4c91-4c90-ab05-7897fb88272f";

const event = (over: Partial<ErrorEvent> = {}): ErrorEvent =>
  ({ event_id: "e1", ...over }) as ErrorEvent;

describe("the carriers of customer data are removed", () => {
  it("drops the request body, which is where a whole SoW travels", () => {
    const out = scrubEvent(
      event({
        request: {
          url: `https://motko.app/jobs/${JOB_ID}`,
          data: { sow_json: { customer_name: "Dave Smith", site_address: "14 Elm Road" } },
        },
      }),
    );

    expect(out.request?.data).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("Dave Smith");
    expect(JSON.stringify(out)).not.toContain("14 Elm Road");
  });

  it("drops cookies", () => {
    const out = scrubEvent(
      event({ request: { url: "https://motko.app/dashboard", cookies: { session: "abc" } } }),
    );
    expect(out.request?.cookies).toBeUndefined();
  });

  it("keeps only the allowlisted headers", () => {
    const out = scrubEvent(
      event({
        request: {
          url: "https://motko.app/dashboard",
          headers: {
            "content-type": "application/json",
            cookie: "session=abc",
            authorization: "Bearer secret",
            referer: "https://motko.app/jobs/x",
          },
        },
      }),
    );

    expect(Object.keys(out.request?.headers ?? {})).toEqual(["content-type"]);
  });

  it("drops the payload of a console breadcrumb but keeps that it happened", () => {
    const out = scrubEvent(
      event({
        breadcrumbs: [
          { category: "console", message: "quote failed", data: { customer: "Dave Smith" } },
        ],
      }),
    );

    expect(out.breadcrumbs?.[0]?.data).toBeUndefined();
    expect(out.breadcrumbs?.[0]?.category).toBe("console");
    expect(JSON.stringify(out)).not.toContain("Dave Smith");
  });

  it("reduces the user object to an id, dropping ip and email", () => {
    const out = scrubEvent(
      event({ user: { id: "u1", email: "dave@example.com", ip_address: "1.2.3.4" } }),
    );
    expect(out.user).toEqual({ id: "u1" });
  });
});

describe("the redaction backstop", () => {
  it("redacts a phone number and an email left in an exception message", () => {
    const out = scrubEvent(
      event({
        exception: {
          values: [{ type: "Error", value: "failed for 07700 900123 / dave@example.com" }],
        },
      }),
    );

    const text = out.exception?.values?.[0]?.value ?? "";
    expect(text).not.toContain("07700 900123");
    expect(text).not.toContain("dave@example.com");
  });

  // Stated rather than glossed: this is the documented limit of the approach.
  // A name in an exception message is not matchable by shape, and the test
  // records that honestly instead of implying a guarantee we do not have.
  it("does NOT catch a bare name in an exception message — the known limit", () => {
    const out = scrubEvent(
      event({ exception: { values: [{ type: "Error", value: "no customer named Dave Smith" }] } }),
    );
    expect(out.exception?.values?.[0]?.value).toContain("Dave Smith");
  });

  it("survives a deeply nested extra without recursing forever", () => {
    let deep: Record<string, unknown> = { leaf: "07700 900123" };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    expect(() => scrubEvent(event({ extra: deep }))).not.toThrow();
  });
});

describe("the run identifier", () => {
  it("is tagged from a job URL, so a crash ties back to its voice run", () => {
    const out = scrubEvent(event({ request: { url: `https://motko.app/jobs/${JOB_ID}/run` } }));
    expect(out.tags?.run_id).toBe(JOB_ID);
  });

  it("is absent rather than wrong when the page is not a job page", () => {
    const out = scrubEvent(event({ request: { url: "https://motko.app/dashboard" } }));
    expect(out.tags?.run_id).toBeUndefined();
  });

  it("reads the id straight from the path", () => {
    expect(runIdFromUrl(`https://motko.app/jobs/${JOB_ID}`)).toBe(JOB_ID);
    expect(runIdFromUrl(undefined)).toBeUndefined();
  });
});
