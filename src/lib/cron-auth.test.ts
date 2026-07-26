import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { rejectUnauthorizedCron } from "@/lib/cron-auth";

// Build a stand-in NextRequest that only exposes the header lookup the guard
// uses — enough to exercise the authorisation branch without a real request.
const requestWith = (authHeader: string | null): NextRequest =>
  ({
    headers: { get: (name: string) => (name === "authorization" ? authHeader : null) },
  }) as unknown as NextRequest;

describe("rejectUnauthorizedCron (fail closed)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects with 401 when CRON_SECRET is unset, even with no header", () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = rejectUnauthorizedCron(requestWith(null));
    expect(res?.status).toBe(401);
  });

  it("rejects with 401 when CRON_SECRET is unset even if a Bearer token is sent", () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = rejectUnauthorizedCron(requestWith("Bearer anything"));
    expect(res?.status).toBe(401);
  });

  it("rejects with 401 when the secret is set but the token is missing", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = rejectUnauthorizedCron(requestWith(null));
    expect(res?.status).toBe(401);
  });

  it("rejects with 401 when the token does not match", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = rejectUnauthorizedCron(requestWith("Bearer wrong"));
    expect(res?.status).toBe(401);
  });

  it("allows the request (returns null) when the Bearer token matches", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const res = rejectUnauthorizedCron(requestWith("Bearer s3cret"));
    expect(res).toBeNull();
  });
});
