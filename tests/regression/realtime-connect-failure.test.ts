// Voice went down on 26 Aug because the OpenAI project ran out of quota, and
// the app's entire response was to tell the operator to try again — advice that
// could never work, on an account they do not own, with no server-side record
// that anything had happened at all.
//
// All four surfaces threw the same fixed string on any non-OK response from
// /v1/realtime/calls, so a rate limit, a spent quota, a revoked key and a
// rejected SDP were indistinguishable.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyRealtimeConnectFailure,
  realtimeConnectFailureContext,
} from "@/lib/realtime-connect-failure";

// Real response bodies, not invented ones.
const QUOTA_BODY = JSON.stringify({
  error: {
    message:
      "You exceeded your current quota, please check your plan and billing details.",
    type: "insufficient_quota",
    param: null,
    code: "insufficient_quota",
  },
});
const RATE_LIMIT_BODY = JSON.stringify({
  error: {
    message: "Rate limit reached for gpt-realtime-mini.",
    type: "requests",
    param: null,
    code: "rate_limit_exceeded",
  },
});
const BAD_KEY_BODY = JSON.stringify({
  error: {
    message: "Incorrect API key provided: ''.",
    type: "invalid_request_error",
    param: null,
    code: "invalid_api_key",
  },
});

describe("classifyRealtimeConnectFailure", () => {
  it("separates the two kinds of 429 — the status alone cannot", () => {
    // This is the whole ticket. Same status, opposite advice.
    expect(classifyRealtimeConnectFailure(429, QUOTA_BODY).retryable).toBe(false);
    expect(classifyRealtimeConnectFailure(429, RATE_LIMIT_BODY).retryable).toBe(true);
  });

  it("never blames the contractor for a spent quota", () => {
    // OPENAI_API_KEY is motko's, one key for the whole product. A contractor
    // reading this has done nothing wrong and can do nothing about it.
    const { message } = classifyRealtimeConnectFailure(429, QUOTA_BODY);

    expect(message).toContain("our side");
    expect(message).not.toMatch(/try again/i);
    expect(message).not.toMatch(/connection|microphone|phone|your account/i);
  });

  it("treats auth failures as terminal whatever the body says", () => {
    for (const status of [401, 403]) {
      expect(classifyRealtimeConnectFailure(status, "").retryable).toBe(false);
    }
    expect(classifyRealtimeConnectFailure(401, BAD_KEY_BODY).code).toBe("invalid_api_key");
  });

  it("treats server errors as retryable", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyRealtimeConnectFailure(status, "").retryable).toBe(true);
    }
  });

  it("defaults to RETRYABLE when the body is empty or unparseable", () => {
    // Under-classifying strands nobody: they retry and either it works or they
    // see the same screen. Over-classifying tells someone to give up on a blip.
    for (const body of ["", "not json", "<html>502 Bad Gateway</html>", "{}"]) {
      expect(classifyRealtimeConnectFailure(429, body).retryable).toBe(true);
    }
  });

  it("keeps the retry copy unchanged for retryable failures", () => {
    expect(classifyRealtimeConnectFailure(429, RATE_LIMIT_BODY).message).toBe(
      "Couldn't connect the live call — try again.",
    );
  });
});

describe("what gets logged", () => {
  it("carries the status and the provider code", () => {
    const context = realtimeConnectFailureContext(
      classifyRealtimeConnectFailure(429, QUOTA_BODY),
      "job-intake",
    );

    expect(context).toEqual({
      surface: "job-intake",
      status: 429,
      code: "insufficient_quota",
      retryable: false,
    });
  });

  it("never carries the raw body, a secret, or an Authorization header", () => {
    const leaky = JSON.stringify({
      error: { code: "insufficient_quota", message: "Bearer sk-proj-SECRET" },
    });
    const serialised = JSON.stringify(
      realtimeConnectFailureContext(
        classifyRealtimeConnectFailure(429, leaky),
        "job-intake",
      ),
    );

    expect(serialised).not.toContain("sk-proj");
    expect(serialised).not.toMatch(/Bearer/i);
  });

  it("names a code even when the provider gave none", () => {
    expect(
      realtimeConnectFailureContext(classifyRealtimeConnectFailure(503, ""), "setup-voice")
        .code,
    ).toBe("none");
  });
});

// Every voice surface, so a fifth cannot quietly ship without this. The 26 Aug
// mic-gate defect recurred twice because a fix was applied to one surface and
// not its sibling.
const SURFACES = [
  "src/components/voice/job-intake.tsx",
  "src/components/voice/cost-intake.tsx",
  "src/app/ledger/query/page.tsx",
  "src/app/setup/voice/page.tsx",
];

describe("every surface that opens a realtime call", () => {
  const sources = SURFACES.map((rel) => ({
    rel,
    source: readFileSync(join(process.cwd(), rel), "utf8"),
  }));

  it("posts to the same endpoint — the list below is complete", () => {
    // If a surface stops matching this, the list is stale rather than the
    // surface being fine.
    for (const { rel, source } of sources) {
      expect(source, `${rel} no longer opens a realtime call`).toContain(
        "v1/realtime/calls",
      );
    }
  });

  it("classifies the failure rather than throwing a fixed string", () => {
    for (const { rel, source } of sources) {
      expect(source, `${rel} does not classify`).toContain(
        "classifyRealtimeConnectFailure",
      );
      expect(
        source.includes('throw new Error("Couldn\'t connect the live call — try again.")'),
        `${rel} still throws the fixed string`,
      ).toBe(false);
    }
  });

  it("reports the failure, so an outage is visible without a support ticket", () => {
    for (const { rel, source } of sources) {
      expect(source, `${rel} does not report`).toContain(
        "realtimeConnectFailureContext",
      );
      // Through the server action, not logError directly: analytics.ts reaches
      // for the server Supabase client, and every one of these is a client
      // component. Typecheck and the suite both pass on a direct import; only
      // `next build` catches it.
      expect(source, `${rel} does not report`).toContain(
        "reportRealtimeConnectFailure",
      );
      expect(source, `${rel} imports server-only analytics`).not.toContain(
        'from "@/lib/analytics"',
      );
    }
  });
});
