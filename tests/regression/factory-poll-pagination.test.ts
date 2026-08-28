import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// A card body longer than 100 Notion blocks used to arrive at the PM with its
// tail missing and nothing to say so. The tail is where a spec keeps its edge
// cases and derived criteria, and a truncated body looks complete in a way an
// empty one does not — an empty body is parked in "Needs spec", a truncated one
// is built from.

beforeEach(() => {
  vi.stubEnv("NOTION_API_KEY", "test-notion-key");
  vi.stubEnv("NOTION_DATABASE_ID", "test-db-id");
  vi.stubEnv("GH_TOKEN", "test-gh-token");
  vi.stubEnv("GITHUB_REPOSITORY", "owner/repo");
  vi.stubEnv("FACTORY_MAX_PER_RUN", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ok = (body: unknown) => ({ ok: true, json: async () => body });

const para = (text: string) => ({
  type: "paragraph",
  paragraph: { rich_text: [{ plain_text: text }] },
});

const readyPage = {
  id: "page-1",
  url: "https://notion.so/page-1",
  created_time: "2026-08-28T00:00:00Z",
  properties: {
    Name: { title: [{ plain_text: "A card" }] },
    Module: { select: { name: "data" } },
    Status: { select: { name: "Ready for factory" } },
    Priority: { number: 1 },
  },
};

const runPoller = async (fetchMock: ReturnType<typeof vi.fn>) => {
  global.fetch = fetchMock as unknown as typeof fetch;
  const { main } = await import("../../scripts/factory/poll-notion.mjs?t=" + Date.now());
  await main();
};

const blockCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter((call) => String(call[0]).includes("/blocks/"));

describe("reading a Notion card body", () => {
  it("follows pagination so a long spec is not silently truncated", async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => para(`block ${i}`));

    const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      void init;
      if (String(url).includes("databases/")) return ok({ results: [readyPage] });
      if (String(url).includes("/blocks/") && String(url).includes("start_cursor=cursor-1")) {
        return ok({ results: [para("DERIVED CRITERIA LIVE HERE")], has_more: false });
      }
      if (String(url).includes("/blocks/")) {
        return ok({ results: firstPage, has_more: true, next_cursor: "cursor-1" });
      }
      return ok({ number: 7, html_url: "https://github.com/owner/repo/issues/7" });
    });

    await runPoller(fetchMock);

    expect(blockCalls(fetchMock)).toHaveLength(2);

    const issueCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes("/issues") && call[1]?.method === "POST",
    );
    expect(issueCall, "an issue should have been created").toBeDefined();

    const body = JSON.parse(String(issueCall![1]?.body)).body as string;
    // Both ends of the card survive the read.
    expect(body).toContain("block 0");
    expect(body).toContain("DERIVED CRITERIA LIVE HERE");
  });

  it("costs exactly one request when the body fits in a single page", async () => {
    const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      void init;
      if (String(url).includes("databases/")) return ok({ results: [readyPage] });
      if (String(url).includes("/blocks/")) {
        return ok({ results: [para("short and complete")], has_more: false });
      }
      return ok({ number: 8, html_url: "https://github.com/owner/repo/issues/8" });
    });

    await runPoller(fetchMock);

    expect(blockCalls(fetchMock)).toHaveLength(1);
  });

  it("still parks a genuinely empty body rather than starting it", async () => {
    // The truncation fix must not blur the empty case, which is the one signal
    // that tells a person their card has no spec on it.
    const fetchMock = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      void init;
      if (String(url).includes("databases/")) return ok({ results: [readyPage] });
      if (String(url).includes("/blocks/")) return ok({ results: [], has_more: false });
      return ok({ number: 9, html_url: "https://github.com/owner/repo/issues/9" });
    });

    await runPoller(fetchMock);

    const createdIssue = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes("/issues") && call[1]?.method === "POST",
    );
    expect(createdIssue).toBeUndefined();

    const parked = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes("pages/page-1") && call[1]?.method === "PATCH",
    );
    expect(parked, "the card should be parked as Needs spec").toBeDefined();
    expect(String(parked![1]?.body)).toContain("Needs spec");
  });
});
