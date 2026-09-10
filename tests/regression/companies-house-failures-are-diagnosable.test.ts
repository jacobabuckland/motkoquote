import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchCompanies, getCompanyByNumber } from "@/lib/companies-house";

/**
 * Companies House started returning 400 on 10 Sep, and nothing in the tree could
 * say why.
 *
 * The events table recorded `Companies House search failed: 400` — accurate, and
 * naming neither which parameter CH objected to nor whether the credential was
 * read at all. Both call sites threw the STATUS and discarded the BODY, which is
 * where CH puts its reason.
 *
 * Two fixes, and the tests below are the two halves of the diagnosis that was
 * missing: the body now reaches the error, and the key is trimmed before it is
 * encoded into the Basic credential.
 */

const originalFetch = globalThis.fetch;
const originalKey = process.env.COMPANIES_HOUSE_API_KEY;

// Both parameters OPTIONAL, deliberately. A zero-argument `vi.fn` infers a
// zero-length tuple, so `mock.calls[0][1]` is TS2493 — unreachable — and the
// header assertions below cannot be written at all. AGENTS.md records this
// costing two items on consecutive derivations.
const respondWith = (status: number, body: string) => {
  const fetchMock = vi.fn(
    async (_url?: string | URL | Request, _init?: RequestInit) =>
      new Response(body, { status }),
  );
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
};

beforeEach(() => {
  process.env.COMPANIES_HOUSE_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.COMPANIES_HOUSE_API_KEY = originalKey;
});

describe("a failure carries Companies House's own reason", () => {
  it("puts the response body in the search error, not just the status", async () => {
    respondWith(400, '{"errors":[{"error":"invalid-authorization-header"}]}');

    await expect(searchCompanies("Buckland")).rejects.toThrow(
      /invalid-authorization-header/,
    );
  });

  it("puts the response body in the company-profile error too", async () => {
    respondWith(400, '{"errors":[{"error":"company-number-invalid"}]}');

    await expect(getCompanyByNumber("NOTANUMBER")).rejects.toThrow(
      /company-number-invalid/,
    );
  });

  it("still reports the status when there is no body to read", async () => {
    respondWith(500, "");

    await expect(searchCompanies("Buckland")).rejects.toThrow(/500/);
  });

  it("keeps a 404 as the plain not-found message a contractor can act on", async () => {
    // CH answering correctly about a number that does not exist is not an
    // application error, and the validate route deliberately does not record it
    // as one. Attaching a provider body here would change that message.
    respondWith(404, '{"errors":[{"error":"company-profile-not-found"}]}');

    await expect(getCompanyByNumber("99999999")).rejects.toThrow("Company number not found");
  });

  it("truncates an unbounded provider body", async () => {
    // This string reaches the contractor's screen through the route's error
    // path as well as the events table.
    respondWith(400, "x".repeat(5000));

    await expect(searchCompanies("Buckland")).rejects.toThrow(
      /^Companies House search failed: 400: x{300}$/,
    );
  });
});

describe("the Basic credential survives a hand-pasted key", () => {
  const authOf = (fetchMock: ReturnType<typeof respondWith>): string => {
    const init = fetchMock.mock.calls[0]?.[1];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    return headers.Authorization;
  };

  it("trims whitespace before encoding, so a pasted newline cannot corrupt it", async () => {
    // A trailing newline survives a paste into a Vercel environment variable
    // invisibly, and here it would be base64-encoded INTO the credential — so
    // CH decodes a username that is not the key. That returns 400 rather than
    // 401, because the header parsed and its contents did not.
    process.env.COMPANIES_HOUSE_API_KEY = "  my-key\n";
    const fetchMock = respondWith(200, '{"items":[]}');

    await searchCompanies("Buckland");

    expect(authOf(fetchMock)).toBe(`Basic ${Buffer.from("my-key:").toString("base64")}`);
  });

  it("keeps the key as the USERNAME with an empty password", async () => {
    // CH's scheme, and the trailing colon is the empty password. Sending the
    // key as a bearer token or in the password field is the documented cause of
    // this exact class of failure — pinned so a future edit cannot quietly
    // change it.
    process.env.COMPANIES_HOUSE_API_KEY = "my-key";
    const fetchMock = respondWith(200, '{"items":[]}');

    await searchCompanies("Buckland");

    const decoded = Buffer.from(authOf(fetchMock).replace("Basic ", ""), "base64").toString();
    expect(decoded).toBe("my-key:");
  });
});
