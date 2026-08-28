import { afterEach, describe, expect, it, vi } from "vitest";
import {
  baseSentryOptions,
  errorReportingEnabled,
  sentryDsn,
} from "@/lib/error-reporting/options";

const DSN = "https://examplekey@o0.ingest.sentry.io/1";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * The gate runs `npm run build` and the whole test suite with no Sentry
 * configuration at all. If error reporting were not inert without a DSN,
 * every one of those runs would try to initialise an SDK pointed at nothing —
 * so "off unless configured" is a contract, not a convenience.
 */
describe("error reporting is inert until configured", () => {
  it("is disabled when no DSN is set", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    expect(sentryDsn()).toBeUndefined();
    expect(errorReportingEnabled()).toBe(false);
    expect(baseSentryOptions().enabled).toBe(false);
  });

  it("is enabled once a DSN is set", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    expect(sentryDsn()).toBe(DSN);
    expect(errorReportingEnabled()).toBe(true);
    expect(baseSentryOptions().enabled).toBe(true);
  });
});

describe("baseSentryOptions", () => {
  it("never sends default PII", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    // With this on, Sentry attaches request headers, cookies and the client
    // IP to every event. For this app that is a contractor's session cookie
    // and a customer's IP on any error raised while viewing a quote.
    expect(baseSentryOptions().sendDefaultPii).toBe(false);
  });

  it("routes every event through the scrubber", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    const scrubbed = baseSentryOptions().beforeSend({
      message: "reached dave@example.com",
    });
    expect(scrubbed).toEqual({ message: "reached [email]" });
  });

  it("leaves tracing off unless a rate is set", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "");
    expect(baseSentryOptions().tracesSampleRate).toBe(0);
  });

  it("honours a valid sample rate", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "0.25");
    expect(baseSentryOptions().tracesSampleRate).toBe(0.25);
  });

  it("falls back to off for an unparseable or out-of-range rate", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);

    vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "all of them");
    expect(baseSentryOptions().tracesSampleRate).toBe(0);

    vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "5");
    expect(baseSentryOptions().tracesSampleRate).toBe(0);

    vi.stubEnv("NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE", "-1");
    expect(baseSentryOptions().tracesSampleRate).toBe(0);
  });
});
