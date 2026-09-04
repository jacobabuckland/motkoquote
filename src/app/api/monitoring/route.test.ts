import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tunnel is a PUBLIC, unauthenticated route (OBS-5, approved 4 Sep 2026),
// so what matters is not that it forwards but what it REFUSES to forward.
//
// Without the DSN check it is an open relay: anyone could POST an envelope
// addressed to any Sentry account and have this server deliver it, from our IP
// and our origin. That is a materially different exposure from "a stranger can
// burn our own quota", and it is the reason this route is hand-written rather
// than generated.

const DSN = "https://abc123@o4512026790526976.ingest.de.sentry.io/4512026798194768";
const OUR_HOST = "o4512026790526976.ingest.de.sentry.io";
const OUR_PROJECT = "4512026798194768";

const envelope = (dsn: string): string =>
  [JSON.stringify({ dsn, sent_at: "2026-09-04T00:00:00Z" }), JSON.stringify({ type: "event" }), "{}"].join("\n");

const post = async (body: string): Promise<Response> => {
  const { POST } = await import("@/app/api/monitoring/route");
  return POST(new Request("https://motko.app/api/monitoring", { method: "POST", body }));
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
  fetchMock = vi.fn(async (_url?: string | URL | Request, _init?: RequestInit) =>
    new Response(null, { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the tunnel forwards only our own envelopes", () => {
  it("forwards one addressed to this project", async () => {
    const response = await post(envelope(DSN));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://${OUR_HOST}/api/${OUR_PROJECT}/envelope/`,
    );
  });

  it("refuses one addressed to a DIFFERENT Sentry account — the open-relay case", async () => {
    const response = await post(
      envelope("https://key@o999.ingest.de.sentry.io/999"),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a matching host but a different project on it", async () => {
    const response = await post(envelope(`https://abc123@${OUR_HOST}/1111111`));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a body that is not an envelope", async () => {
    const response = await post("not json at all");

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an envelope whose header carries no dsn", async () => {
    const response = await post([JSON.stringify({ sent_at: "x" }), "{}"].join("\n"));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("when this app has no DSN", () => {
  it("404s and forwards nothing, rather than being lenient", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    vi.resetModules();

    const response = await post(envelope(DSN));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("what it tells an unauthenticated caller", () => {
  it("does not echo an upstream failure back", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("sentry says: project 4512026798194768 over quota", { status: 429 }),
    );

    const response = await post(envelope(DSN));

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("");
  });
});
