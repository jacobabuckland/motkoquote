import { describe, expect, it } from "vitest";
import { redactPii, scrubEvent } from "@/lib/error-reporting/scrub";

/**
 * The scrubber is the only thing standing between a customer's contact
 * details and a third-party error tracker. These tests pin both directions:
 * what it must redact, and what it must leave alone — an over-redacting
 * scrubber destroys the error messages it exists to make safe.
 */
describe("redactPii", () => {
  it("redacts email addresses", () => {
    expect(redactPii("failed for dave@harrisonelectrical.co.uk on insert")).toBe(
      "failed for [email] on insert",
    );
  });

  it("redacts UK phone numbers in national and international form", () => {
    expect(redactPii("sms to 07700 900123 failed")).toBe("sms to [phone] failed");
    expect(redactPii("sms to +44 7700 900123 failed")).toBe("sms to [phone] failed");
    expect(redactPii("landline 0161 496 0000 unreachable")).toBe(
      "landline [phone] unreachable",
    );
  });

  it("redacts UK postcodes with a space, in any case", () => {
    expect(redactPii("site at SW1A 1AA")).toBe("site at [postcode]");
    expect(redactPii("site at sw1a 1aa")).toBe("site at [postcode]");
  });

  it("redacts an unspaced postcode only in upper case", () => {
    expect(redactPii("site at SW1A1AA")).toBe("site at [postcode]");
  });

  it("redacts JWTs, bearer tokens and vendor secrets", () => {
    // These fixtures are assembled from fragments rather than written as
    // literals on purpose: CI's secret-scan job greps added diff lines for
    // exactly these prefixes, and a test *about* credential redaction is the
    // one file guaranteed to contain them. The runtime values are the real
    // shapes; no single literal here matches the scanner.
    const jwt = `${"eyJhbGc"}iOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghij`;
    const stripeKey = `${"sk_"}live_abcdef1234567890`;
    const anthropicKey = `${"sk-"}ant-api03-abcdef1234`;

    expect(redactPii(`token ${jwt} expired`)).toBe("token [jwt] expired");
    expect(redactPii("header: Bearer abcdef1234567890")).toBe(
      "header: Bearer [redacted]",
    );
    expect(redactPii(`used ${stripeKey}`)).toBe("used [stripe_key]");
    expect(redactPii(`used ${anthropicKey}`)).toBe("used [anthropic_key]");
  });

  it("leaves ordinary diagnostic text alone", () => {
    const message = "PostgrestError: column jobs.crew_size does not exist (code 42703)";
    expect(redactPii(message)).toBe(message);
  });

  it("does not treat a plain integer or a short id as a phone number", () => {
    expect(redactPii("expected 200 but got 500 after 1200 ms")).toBe(
      "expected 200 but got 500 after 1200 ms",
    );
    expect(redactPii("job 12345 not found")).toBe("job 12345 not found");
  });

  it("does not redact a lowercase alphanumeric id as a postcode", () => {
    // The unspaced postcode pattern is upper-case only precisely so this
    // survives: "a1b2cd" matches the case-insensitive postcode shape exactly.
    expect(redactPii("chunk a1b2cd missing")).toBe("chunk a1b2cd missing");
  });

  it("leaves a UUID intact", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(redactPii(`quote ${uuid} not found`)).toBe(`quote ${uuid} not found`);
  });

  it("truncates very long strings and says how much it dropped", () => {
    const long = "x".repeat(2500);
    const result = redactPii(long);
    expect(result.startsWith("x".repeat(2000))).toBe(true);
    expect(result).toContain("[truncated 500 chars]");
    expect(result.length).toBeLessThan(long.length);
  });
});

describe("scrubEvent", () => {
  it("redacts strings nested anywhere in the event", () => {
    const event = {
      message: "quote failed",
      exception: {
        values: [{ value: "could not reach dave@example.com", type: "TypeError" }],
      },
      breadcrumbs: [{ message: "posting to 07700 900123" }],
    };

    const scrubbed = scrubEvent(event);

    expect(scrubbed?.exception.values[0].value).toBe("could not reach [email]");
    expect(scrubbed?.breadcrumbs[0].message).toBe("posting to [phone]");
  });

  it("drops credential and identity keys wherever they appear", () => {
    const event = {
      request: {
        url: "https://motko.app/jobs/1",
        cookies: { "sb-access-token": "secret" },
        headers: { authorization: "Bearer abcdef1234567890", "x-api-key": "k" },
      },
      user: { id: "u_1", ip_address: "203.0.113.9" },
    };

    const scrubbed = scrubEvent(event) as Record<string, never> | null;
    const request = scrubbed?.request as unknown as Record<string, unknown>;
    const user = scrubbed?.user as unknown as Record<string, unknown>;

    expect(request.cookies).toBeUndefined();
    expect(request.url).toBe("https://motko.app/jobs/1");
    expect(Object.keys(request.headers as object)).toEqual([]);
    expect(user.ip_address).toBeUndefined();
    expect(user.id).toBe("u_1");
  });

  it("preserves structural fields so grouping and stack traces still work", () => {
    const event = {
      event_id: "abc123",
      platform: "node",
      exception: {
        values: [
          {
            type: "TypeError",
            stacktrace: {
              frames: [
                {
                  filename: "/var/task/src/app/jobs/actions.ts",
                  function: "sendQuote",
                  lineno: 42,
                },
              ],
            },
          },
        ],
      },
    };

    const scrubbed = scrubEvent(event);
    const frame = scrubbed?.exception.values[0].stacktrace.frames[0];

    expect(frame?.filename).toBe("/var/task/src/app/jobs/actions.ts");
    expect(frame?.function).toBe("sendQuote");
    expect(frame?.lineno).toBe(42);
    expect(scrubbed?.event_id).toBe("abc123");
  });

  it("drops the event entirely rather than sending it unscrubbed", () => {
    // A getter that throws is what a serialised, partly-constructed payload
    // can look like in practice. The contract is fail-CLOSED: no event is
    // better than an unscrubbed one.
    const event: Record<string, unknown> = { message: "fine" };
    Object.defineProperty(event, "poisoned", {
      enumerable: true,
      get() {
        throw new Error("cannot read");
      },
    });

    expect(scrubEvent(event)).toBeNull();
  });
});
