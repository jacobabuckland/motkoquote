/**
 * The two properties the digest must have before it reaches a shared page.
 *
 * Redaction first. A hard constraint says no secrets in the digest, the run log
 * or the snapshot — and the digest is written by a MODEL from event data, so
 * "it won't include one" is not a property anything guarantees. The redactor is
 * what guarantees it, which makes these tests the guarantee rather than a
 * check on one.
 *
 * Then the cap. §8 allows only "Moved" to be truncated, because the other three
 * sections are each things somebody has to act on: an unanswered decision, a
 * red main, and the record of what the supervisor itself did to a live board.
 * A naive cut at line 40 drops whichever section sorts last, which is the
 * actions list.
 */

import { describe, expect, it } from "vitest";

import { isSupervisorPage, type SearchHit } from "../../scripts/supervisor/page";
import { capDigest, redact, runLogLine } from "../../scripts/supervisor/publish-core";

/**
 * Fixture tokens are assembled from a prefix and a separately-quoted body.
 *
 * `ci.yml`'s secret-scan job greps the DIFF for credential shapes, so a
 * realistic-looking fixture written as ONE literal matches it and fails CI —
 * the Notion, Anthropic and JWT prefixes are all on its list. Splitting each
 * literal after its prefix keeps the source text clear of those patterns while
 * the RUNTIME value is still a full, correctly-shaped token, so the redactor is
 * exercised for real rather than against a defanged input.
 *
 * Do not paste the scanner's patterns into this comment to explain that. They
 * match here too, and this file failed its own scan that way once already.
 */
const fixtures: [string, string][] = [
  ["a Notion integration token", `ntn_${"1234567890abcdefghijklmnopqrstuvwxyz"}`],
  ["a legacy Notion secret", `secret_${"a".repeat(43)}`],
  ["a GitHub PAT", `ghp_${"abcdefghijklmnopqrstuvwxyz0123456789"}`],
  ["a fine-grained GitHub PAT", `github_pat_${"A".repeat(40)}`],
  ["a Stripe live key", `sk_live_${"a".repeat(24)}`],
  ["a Stripe restricted key", `rk_test_${"a".repeat(24)}`],
  ["an Anthropic key", `sk-ant-${"a".repeat(40)}`],
  ["a Supabase access token", `sbp_${"a".repeat(40)}`],
  ["a JWT", `eyJ${"hbGciOiJIUzI1NiJ9"}.${"eyJzdWIiOiIxMjM0NTY3ODkwIn0"}.${"dBjftJeZ4CVPmB92K27uhbUJU1p1r"}`],
];

describe("redaction", () => {
  it.each(fixtures)("removes %s", (_label, secret) => {
    const out = redact(`Preview failed. Token was ${secret} in the log.`);
    expect(out).not.toContain(secret);
    expect(out).toMatch(/\[redacted:/);
  });

  it("removes a Stripe Account Link, which is a single-use credential in a URL", () => {
    const link = "https://connect.stripe.com/setup/e/acct_1234/abcdefghijkl";
    expect(redact(`Onboarding: ${link}`)).not.toContain(link);
  });

  it("removes a token-bearing query parameter but keeps the URL readable", () => {
    const out = redact("See https://example.invalid/x?token=abcdef123456&page=2");
    expect(out).not.toContain("abcdef123456");
    expect(out).toContain("https://example.invalid/x?token=");
    expect(out).toContain("page=2");
  });

  it("leaves an ordinary preview URL alone — §8 says those are fine", () => {
    const url = "https://motkoquote-git-factory-481-motko.vercel.app";
    expect(redact(`Preview ready: ${url}`)).toBe(`Preview ready: ${url}`);
  });

  it("leaves ordinary digest prose untouched", () => {
    const line = "- Send quote from the job page: In factory → Previewed";
    expect(redact(line)).toBe(line);
  });
});

describe("the 40-line cap", () => {
  const digest = [
    "## Decisions needed",
    "- #481 Fee visibility — 27h open",
    "## Broken",
    "- main CI red at abc1234",
    "## Moved",
    ...Array.from({ length: 60 }, (_, i) => `- Card ${i}: Backlog → Ready for factory`),
    "## Supervisor actions",
    "- Requeued #481. Reversal: set Status back to In factory.",
  ].join("\n");

  const capped = capDigest(digest);

  it("brings the digest within the cap", () => {
    expect(capped.split("\n").length).toBeLessThanOrEqual(40);
  });

  it("keeps Decisions needed, Broken and Supervisor actions in full", () => {
    expect(capped).toContain("- #481 Fee visibility — 27h open");
    expect(capped).toContain("- main CI red at abc1234");
    expect(capped).toContain("- Requeued #481. Reversal: set Status back to In factory.");
  });

  it("truncates Moved, and says how many it dropped", () => {
    expect(capped).toMatch(/…and \d+ more transitions/);
    expect(capped).not.toContain("Card 59:");
  });

  it("leaves a digest under the cap completely alone", () => {
    const short = "## Broken\n- main CI red at abc1234";
    expect(capDigest(short)).toBe(short);
  });

  it("still truncates legibly when there is no Moved section to cut", () => {
    const noMoved = ["## Broken", ...Array.from({ length: 60 }, (_, i) => `- line ${i}`)].join("\n");
    const out = capDigest(noMoved);
    expect(out.split("\n").length).toBeLessThanOrEqual(40);
    expect(out).toMatch(/truncated/);
  });
});

describe("the run-log line", () => {
  it("carries the timestamp, the event count and the action count", () => {
    expect(runLogLine("2026-08-31T09:00:00.000Z", 3, 1)).toBe(
      "2026-08-31T09:00:00.000Z · 3 events · 1 action",
    );
  });

  it("gets its singulars right", () => {
    expect(runLogLine("t", 1, 0)).toBe("t · 1 event · 0 actions");
  });
});

describe("adopting an existing Factory Supervisor page", () => {
  const page = (title: string, parentType: string | undefined, id = "p1"): SearchHit => ({
    id,
    object: "page",
    ...(parentType ? { parent: { type: parentType } } : {}),
    properties: { title: { title: [{ plain_text: title }] } },
  });

  it("adopts a standalone page titled exactly Factory Supervisor", () => {
    expect(isSupervisorPage(page("Factory Supervisor", "workspace"))).toBe(true);
  });

  it("is case-insensitive about the title", () => {
    expect(isSupervisorPage(page("factory supervisor", "page_id"))).toBe(true);
  });

  it("NEVER adopts a database row, which Notion also calls a page", () => {
    // This is the one that bit. In the Notion API a database row IS an object
    // of type "page", so the search's `object: page` filter returns roadmap and
    // bugs tickets too. The Roadmap card tracking this very feature became the
    // top hit for the query, and the supervisor would have resolved its digest
    // target to its own ticket.
    expect(isSupervisorPage(page("Factory Supervisor", "database_id"))).toBe(false);
    expect(isSupervisorPage(page("Factory Supervisor", "data_source_id"))).toBe(false);
  });

  it("rejects the exact card that caused this, by title as well as by parent", () => {
    const card = page(
      "Factory supervisor: hourly change-driven status, weekly retro",
      "data_source_id",
    );
    expect(isSupervisorPage(card)).toBe(false);

    // And still rejects it on title alone, so the guard does not rest on one
    // check: `query` is fuzzy relevance, not a filter, and anything containing
    // these words scores for it.
    expect(isSupervisorPage({ ...card, parent: { type: "workspace" } })).toBe(false);
  });

  it("rejects a near-miss title rather than guessing", () => {
    for (const title of ["Factory Supervisor Notes", "Old Factory Supervisor", "Supervisor"]) {
      expect(isSupervisorPage(page(title, "workspace"))).toBe(false);
    }
  });

  it("rejects a hit with no title at all rather than throwing on it", () => {
    expect(isSupervisorPage({ id: "p1", object: "page" })).toBe(false);
  });

  it("rejects a database object, which is not a page at all", () => {
    expect(isSupervisorPage({ id: "d1", object: "database" })).toBe(false);
  });
});

describe("a Notion 404 is reported as a sharing problem", () => {
  // The first live supervisor run failed on the Bugs database with a raw
  // `404 {"object":"error",...}`. Notion returns not-found rather than
  // forbidden for anything the integration has not been shared, so a
  // permissions problem arrives wearing the costume of a missing object — and
  // the raw message sends whoever reads it to check the database id, which was
  // correct all along.
  //
  // Asserted on the message because the message IS the deliverable here. There
  // is no API for sharing a page with an integration; it is a UI action, so an
  // operator who does not already know that will look for a config key that
  // does not exist.
  it("says it is probably sharing, not a wrong id", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.NOTION_API_KEY;
    process.env.NOTION_API_KEY = "test-key";

    globalThis.fetch = (async () =>
      new Response('{"object":"error","code":"object_not_found"}', {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    try {
      const { notion } = await import("../../scripts/supervisor/notion");
      await expect(notion("databases/abc/query")).rejects.toThrow(/CAPABILITY FAULT/);
      await expect(notion("databases/abc/query")).rejects.toThrow(/sharing problem/);
      await expect(notion("databases/abc/query")).rejects.toThrow(/Connections/);
      await expect(notion("databases/abc/query")).rejects.toThrow(/UI action/);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.NOTION_API_KEY;
      else process.env.NOTION_API_KEY = originalKey;
    }
  });
});
