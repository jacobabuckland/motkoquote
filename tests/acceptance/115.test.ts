import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Issue #115: Give the factory poller a deterministic queue order
 *
 * These tests verify that the Notion query includes an explicit sort order,
 * that consecutive polls are deterministic, and that edge cases (ties, unset
 * values, missing property) are handled correctly.
 *
 * Since poll-notion.mjs is a script (not a module export), these tests verify
 * the behaviour by mocking fetch and observing the Notion API calls it makes.
 */

// Mock environment variables required by the poller
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

// Helper to create a minimal Notion page result for testing
const notionPage = (
  id: string,
  name: string,
  priority: number | null,
  createdTime: string
) => ({
  id,
  url: `https://notion.so/${id}`,
  created_time: createdTime,
  properties: {
    Name: { title: [{ plain_text: name }] },
    Module: { select: { name: "test-module" } },
    Status: { select: { name: "Ready for factory" } },
    Priority: priority === null ? {} : { number: priority },
  },
});

describe("Issue #115: Give the factory poller a deterministic queue order", () => {
  describe("Notion query includes explicit sort", () => {
    it("passes a sorts parameter in the database query", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      // Mock the Notion database query to return no results (simplest case)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      // Dynamically import the script so it runs with mocked fetch
      // IMPORTANT: the script must be modified to export its main() function
      // or this test will need to spawn it as a subprocess and parse output.
      // For now, we assume main() will be exported for testing.
      const { main } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main();

      // Verify that the Notion query was called
      const notionQueryCall = fetchMock.mock.calls.find((call) =>
        call[0].includes("databases/test-db-id/query")
      );

      expect(notionQueryCall).toBeDefined();

      // Verify that the request body includes a sorts parameter
      const requestBody = JSON.parse(notionQueryCall![1].body);
      expect(requestBody).toHaveProperty("sorts");
      expect(requestBody.sorts).toBeInstanceOf(Array);
      expect(requestBody.sorts.length).toBeGreaterThan(0);
    });

    it("sorts by Priority ascending as primary sort", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const { main } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main();

      const notionQueryCall = fetchMock.mock.calls.find((call) =>
        call[0].includes("databases/test-db-id/query")
      );
      const requestBody = JSON.parse(notionQueryCall![1].body);

      // The first sort should be by Priority, ascending (lower values first)
      expect(requestBody.sorts[0]).toEqual({
        property: "Priority",
        direction: "ascending",
      });
    });

    it("includes a stable secondary sort for tie-breaking", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const { main } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main();

      const notionQueryCall = fetchMock.mock.calls.find((call) =>
        call[0].includes("databases/test-db-id/query")
      );
      const requestBody = JSON.parse(notionQueryCall![1].body);

      // The second sort should be a stable tie-breaker (e.g. created_time)
      expect(requestBody.sorts.length).toBeGreaterThanOrEqual(2);
      expect(requestBody.sorts[1]).toHaveProperty("timestamp");
      expect(requestBody.sorts[1].timestamp).toBe("created_time");
      expect(requestBody.sorts[1].direction).toBe("ascending");
    });
  });

  describe("Deterministic ordering", () => {
    it("returns the same item on consecutive polls with no board changes", async () => {
      // Notion applies the sort server-side and returns results already
      // ordered, so a faithful mock returns them sorted. Scrambling them here
      // would only pass if the poller re-sorted client-side, which the spec
      // forbids: that reorders one page of a paginated result, which is the
      // bug this item exists to remove.
      const pages = [
        notionPage("page-2", "Item B", 1, "2026-01-01T11:00:00Z"),
        notionPage("page-1", "Item A", 2, "2026-01-01T10:00:00Z"),
        notionPage("page-3", "Item C", 3, "2026-01-01T09:00:00Z"),
      ];

      // First poll
      const fetchMock1 = vi.fn();
      global.fetch = fetchMock1;

      fetchMock1
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: pages }),
        })
        .mockResolvedValueOnce({
          // Page body for the selected item
          ok: true,
          json: async () => ({
            results: [
              {
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "Test spec" }] },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          // GitHub issue creation
          ok: true,
          json: async () => ({ number: 123, html_url: "https://github.com/..." }),
        })
        .mockResolvedValueOnce({
          // Notion status update
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          // GitHub label addition
          ok: true,
          json: async () => ({}),
        });

      const { main: main1 } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main1();

      // Find which page was selected (the one whose children were fetched)
      const blocksFetch1 = fetchMock1.mock.calls.find((call) =>
        call[0].includes("/blocks/")
      );
      const selectedPage1 = blocksFetch1![0].match(/blocks\/(page-\d+)\/children/)[1];

      // Second poll (same pages, same order)
      const fetchMock2 = vi.fn();
      global.fetch = fetchMock2;

      fetchMock2
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: pages }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              {
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "Test spec" }] },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ number: 124, html_url: "https://github.com/..." }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const { main: main2 } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main2();

      const blocksFetch2 = fetchMock2.mock.calls.find((call) =>
        call[0].includes("/blocks/")
      );
      const selectedPage2 = blocksFetch2![0].match(/blocks\/(page-\d+)\/children/)[1];

      // Both polls should select the same page (the one with lowest Priority)
      expect(selectedPage1).toBe(selectedPage2);
      expect(selectedPage1).toBe("page-2"); // Item B has Priority=1 (lowest)
    });
  });

  describe("Tie-breaking", () => {
    it("breaks ties by created_time when Priority values are equal", async () => {
      const pages = [
        // Sorted as Notion returns them: equal Priority, so created_time
        // ascending decides — earliest, middle, latest.
        notionPage("page-2", "Item B", 1, "2026-01-01T10:00:00Z"), // earliest
        notionPage("page-3", "Item C", 1, "2026-01-01T11:00:00Z"), // middle
        notionPage("page-1", "Item A", 1, "2026-01-01T12:00:00Z"), // latest
      ];

      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: pages }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              {
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "Test spec" }] },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ number: 125, html_url: "https://github.com/..." }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const { main } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main();

      const blocksFetch = fetchMock.mock.calls.find((call) =>
        call[0].includes("/blocks/")
      );
      const selectedPage = blocksFetch![0].match(/blocks\/(page-\d+)\/children/)[1];

      // Should select page-2 (earliest created_time among the tie)
      expect(selectedPage).toBe("page-2");
    });

    it("produces a stable order when all items have the same Priority", async () => {
      const pages = [
        // Sorted as Notion returns them: all Priority 5, created_time ascending.
        notionPage("page-2", "Item B", 5, "2026-01-01T12:00:00Z"),
        notionPage("page-3", "Item C", 5, "2026-01-01T13:00:00Z"),
        notionPage("page-1", "Item A", 5, "2026-01-01T14:00:00Z"),
      ];

      // First poll
      const fetchMock1 = vi.fn();
      global.fetch = fetchMock1;

      fetchMock1
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: pages }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              {
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "Test spec" }] },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ number: 126, html_url: "https://github.com/..." }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const { main: main1 } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main1();

      const blocksFetch1 = fetchMock1.mock.calls.find((call) =>
        call[0].includes("/blocks/")
      );
      const selectedPage1 = blocksFetch1![0].match(/blocks\/(page-\d+)\/children/)[1];

      // Second poll (same pages in same order)
      const fetchMock2 = vi.fn();
      global.fetch = fetchMock2;

      fetchMock2
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: pages }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              {
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "Test spec" }] },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ number: 127, html_url: "https://github.com/..." }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const { main: main2 } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main2();

      const blocksFetch2 = fetchMock2.mock.calls.find((call) =>
        call[0].includes("/blocks/")
      );
      const selectedPage2 = blocksFetch2![0].match(/blocks\/(page-\d+)\/children/)[1];

      // Both polls should select the same page
      expect(selectedPage1).toBe(selectedPage2);
      // Should select page-2 (earliest created_time)
      expect(selectedPage1).toBe("page-2");
    });
  });

  describe("Unset Priority values", () => {
    it("sorts items with no Priority value after items with a value", async () => {
      const pages = [
        // Sorted as Notion returns them: a set Priority sorts ahead of unset,
        // and the unset ones fall back to created_time ascending.
        notionPage("page-2", "Has priority", 10, "2026-01-01T11:00:00Z"),
        notionPage("page-3", "Also no priority", null, "2026-01-01T09:00:00Z"),
        notionPage("page-1", "No priority", null, "2026-01-01T10:00:00Z"),
      ];

      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: pages }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              {
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "Test spec" }] },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ number: 128, html_url: "https://github.com/..." }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const { main } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main();

      const blocksFetch = fetchMock.mock.calls.find((call) =>
        call[0].includes("/blocks/")
      );
      const selectedPage = blocksFetch![0].match(/blocks\/(page-\d+)\/children/)[1];

      // Should select page-2 (the only one with a Priority value set)
      expect(selectedPage).toBe("page-2");
    });

    it("still processes items with no Priority when all are unset", async () => {
      const pages = [
        // Sorted as Notion returns them: every Priority unset, so created_time
        // ascending is the whole order.
        notionPage("page-2", "No priority B", null, "2026-01-01T10:00:00Z"),
        notionPage("page-3", "No priority C", null, "2026-01-01T11:00:00Z"),
        notionPage("page-1", "No priority A", null, "2026-01-01T12:00:00Z"),
      ];

      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: pages }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [
              {
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "Test spec" }] },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ number: 129, html_url: "https://github.com/..." }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const { main } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main();

      const blocksFetch = fetchMock.mock.calls.find((call) =>
        call[0].includes("/blocks/")
      );
      const selectedPage = blocksFetch![0].match(/blocks\/(page-\d+)\/children/)[1];

      // Should select page-2 (earliest created_time among the unset group)
      expect(selectedPage).toBe("page-2");
    });
  });

  describe("Failure mode: missing Priority property", () => {
    it("fails with a clear error if the Priority property does not exist", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      // Mock Notion returning an error indicating the property doesn't exist
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            object: "error",
            status: 400,
            code: "validation_error",
            message: 'Property "Priority" does not exist.',
          }),
      });

      const { main } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );

      // The main function should throw an error that mentions the missing property
      await expect(main()).rejects.toThrow(/Priority/);
    });
  });

  describe("Existing behaviour preserved", () => {
    it("still filters by Status = Ready for factory", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      const { main } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main();

      const notionQueryCall = fetchMock.mock.calls.find((call) =>
        call[0].includes("databases/test-db-id/query")
      );
      const requestBody = JSON.parse(notionQueryCall![1].body);

      // The filter should still be present
      expect(requestBody).toHaveProperty("filter");
      expect(requestBody.filter).toEqual({
        property: "Status",
        select: { equals: "Ready for factory" },
      });
    });

    it("still skips items with empty page body without consuming a slot", async () => {
      const pages = [
        notionPage("page-1", "Empty item", 1, "2026-01-01T10:00:00Z"),
        notionPage("page-2", "Has spec", 2, "2026-01-01T11:00:00Z"),
      ];

      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: pages }),
        })
        .mockResolvedValueOnce({
          // page-1 has empty body
          ok: true,
          json: async () => ({ results: [] }),
        })
        .mockResolvedValueOnce({
          // Notion update to park page-1
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          // page-2 has content
          ok: true,
          json: async () => ({
            results: [
              {
                type: "paragraph",
                paragraph: { rich_text: [{ plain_text: "Test spec" }] },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ number: 130, html_url: "https://github.com/..." }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const { main } = await import(
        "../../scripts/factory/poll-notion.mjs?t=" + Date.now()
      );
      await main();

      // Should have fetched blocks for both pages
      const blocksFetches = fetchMock.mock.calls.filter((call) =>
        call[0].includes("/blocks/")
      );
      expect(blocksFetches.length).toBe(2);

      // Should have created exactly one GitHub issue (for page-2)
      const ghIssueCalls = fetchMock.mock.calls.filter((call) =>
        call[0].includes("repos/owner/repo/issues") &&
        call[1]?.method === "POST" &&
        !call[0].includes("/labels")
      );
      expect(ghIssueCalls.length).toBe(1);
    });
  });
});
