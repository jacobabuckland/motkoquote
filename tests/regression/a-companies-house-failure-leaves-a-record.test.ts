import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNextRequest } from "../helpers/next-request";

/**
 * A Companies House failure has to leave a record.
 *
 * Both routes caught their error, returned the message in the response body,
 * and told nobody. Sentry only captures what reaches `onRequestError`
 * (src/instrumentation.ts) and a caught error never does — so the integration
 * could fail in production with the sole trace being whatever the contractor
 * happened to read on the setup screen.
 *
 * It did fail. The key returned 401 for long enough to reach a remediation
 * plan, and a search of Sentry found **not one** Companies House event across
 * 90 days to diagnose it from. The validate route was worse than silent: its
 * console.error named the company number and NOT the error, so it logged the
 * one thing that was working.
 *
 * WHAT THIS IS NOT: the signal that changes behaviour. `chError` on the setup
 * form already tells the contractor the lookup failed and they can type the
 * number by hand. This is the evidence behind it — the same split
 * api/push/diagnostics records for itself.
 */

const logError = vi.fn(async (_source?: string, _message?: string, _context?: unknown) => {});
const searchCompanies = vi.fn(async (_query?: string): Promise<unknown[]> => []);
const validateCompanyNumber = vi.fn(async (_input?: unknown): Promise<unknown> => ({}));

vi.mock("@/lib/analytics", () => ({ logError, track: vi.fn(async () => {}) }));
vi.mock("@/lib/companies-house", () => ({ searchCompanies, validateCompanyNumber }));

beforeEach(() => {
  logError.mockClear();
  searchCompanies.mockClear();
  validateCompanyNumber.mockClear();
});

afterEach(() => {
  vi.resetModules();
});

describe("the search route", () => {
  it("records the reason when the lookup fails", async () => {
    // The live symptom, verbatim: companies-house.ts throws this on a rejected
    // key, and it is what nobody could see.
    searchCompanies.mockRejectedValueOnce(new Error("Companies House search failed: 401"));
    const { GET } = await import("@/app/api/companies-house/search/route");

    const response = await GET(
      createNextRequest({ url: "http://localhost:3000/api/companies-house/search?q=buckland" }),
    );

    expect(response.status).toBe(502);
    expect(logError).toHaveBeenCalledTimes(1);
    const [source, message, context] = logError.mock.calls[0]!;
    expect(source).toBe("server");
    expect(message).toBe("Companies House search failed");
    expect((context as { reason: string }).reason).toContain("401");
  });

  it("still returns the message to the caller", async () => {
    // The contractor-facing half is unchanged: they are told, and can proceed
    // by typing the number themselves.
    searchCompanies.mockRejectedValueOnce(new Error("Companies House search failed: 401"));
    const { GET } = await import("@/app/api/companies-house/search/route");

    const response = await GET(
      createNextRequest({ url: "http://localhost:3000/api/companies-house/search?q=buckland" }),
    );

    expect(((await response.json()) as { error: string }).error).toContain("401");
  });

  it("records nothing on a successful search", async () => {
    searchCompanies.mockResolvedValueOnce([{ company_number: "01234567" }]);
    const { GET } = await import("@/app/api/companies-house/search/route");

    const response = await GET(
      createNextRequest({ url: "http://localhost:3000/api/companies-house/search?q=buckland" }),
    );

    expect(response.status).toBe(200);
    expect(logError).not.toHaveBeenCalled();
  });

  it("records nothing for a query too short to send", async () => {
    // Never reaches the API, so there is no integration failure to report.
    const { GET } = await import("@/app/api/companies-house/search/route");

    await GET(createNextRequest({ url: "http://localhost:3000/api/companies-house/search?q=b" }));

    expect(searchCompanies).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it("never puts the API key in what it records", async () => {
    // The message it logs is built from the thrown error, which carries a
    // status code and no credential. Pinned because a future "include the
    // request for context" is exactly how a key reaches a log.
    searchCompanies.mockRejectedValueOnce(new Error("Companies House search failed: 401"));
    const { GET } = await import("@/app/api/companies-house/search/route");

    await GET(
      createNextRequest({ url: "http://localhost:3000/api/companies-house/search?q=buckland" }),
    );

    expect(JSON.stringify(logError.mock.calls[0])).not.toMatch(/authorization|basic |api[_-]?key/i);
  });
});

describe("the validate route", () => {
  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/companies-house/validate/route");
    return POST(
      createNextRequest({
        method: "POST",
        url: "http://localhost:3000/api/companies-house/validate",
        body,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  it("records a credential failure, which it used to swallow", async () => {
    // Its console.error named the company number and not the error — it logged
    // the one thing that was working.
    validateCompanyNumber.mockRejectedValueOnce(
      new Error("Companies House lookup failed: 401"),
    );

    const response = await post({ company_number: "01234567" });

    expect(response.status).toBe(500);
    expect(logError).toHaveBeenCalledTimes(1);
    const [, message, context] = logError.mock.calls[0]!;
    expect(message).toBe("Companies House validation failed");
    expect((context as { reason: string }).reason).toContain("401");
  });

  it("does NOT record a company number that simply does not exist", async () => {
    // A 404 is the API answering correctly. Recording it would bury the
    // credential faults this exists to surface under contractor typos.
    validateCompanyNumber.mockRejectedValueOnce(new Error("Company not found"));

    const response = await post({ company_number: "99999999" });

    expect(response.status).toBe(404);
    expect(logError).not.toHaveBeenCalled();
  });

  it("records nothing on a successful validation", async () => {
    validateCompanyNumber.mockResolvedValueOnce({ matches: true });

    const response = await post({ company_number: "01234567" });

    expect(response.status).toBe(200);
    expect(logError).not.toHaveBeenCalled();
  });
});
