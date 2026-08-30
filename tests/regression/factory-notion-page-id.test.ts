import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Four roadmap items shipped on 30 Aug with GitHub saying "shipped" and Notion
// still saying "Blocked". The write-back reads a Notion page id out of the
// issue body, and it only ever looked for the HTML-comment marker the poller
// writes:
//
//   <!-- notion-page-id: 3ca1e4f908b48113ba33d497bb339cce -->
//
// A card body gets EDITED as a normal part of running this factory — a
// derivation fails, the card turns out to be the defect, the body is rewritten.
// Whoever rewrites it works from the rendered issue, where an HTML comment is
// invisible, so the marker goes without anyone seeing it go. The write-back
// then exits 0 with "skipping write-back", and Notion is wrong for ever.
//
// #419 and #424 were correct on the same day; their bodies had never been
// edited. That is what identified the cause.
//
// The Source link is the second source, and it survives an edit because it is
// visible markdown.

const SCRIPT = "scripts/factory/notion-page-id.sh";
const PAGE_ID = "3ca1e4f908b48113ba33d497bb339cce";

const idFor = (body: string): { status: number; out: string } => {
  try {
    return { status: 0, out: execFileSync(SCRIPT, { input: body, encoding: "utf8" }).trim() };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { status: e.status ?? 1, out: (e.stdout ?? "").trim() };
  }
};

describe("notion-page-id", () => {
  it("reads the marker the poller writes", () => {
    const body = `**Source:** [Notion roadmap item](https://app.notion.com/p/T-${PAGE_ID})\n\n---\n\n<!-- notion-page-id: ${PAGE_ID} -->`;
    expect(idFor(body).out).toBe(PAGE_ID);
  });

  it("falls back to the Source link when a card edit dropped the marker", () => {
    // The exact shape #424 had on 30 Aug: Source link, no marker.
    const body = [
      `**Source:** [Notion roadmap item](https://app.notion.com/p/PRICE-2-Draft-from-locked-line-items-generating-descriptions-only-${PAGE_ID})`,
      "**Module:** voice",
      "",
      "---",
      "",
      "# Problem",
      "",
      "---",
      "",
    ].join("\n");

    const { status, out } = idFor(body);

    expect(status).toBe(0);
    expect(out).toBe(PAGE_ID);
  });

  it("prefers the marker when both are present", () => {
    const other = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const body = `**Source:** [x](https://app.notion.com/p/T-${other})\n<!-- notion-page-id: ${PAGE_ID} -->`;
    expect(idFor(body).out).toBe(PAGE_ID);
  });

  it("takes the id from the END of the slug, not a hex run inside the title", () => {
    // A title can contain something hex-shaped. The id is always last.
    const body = `**Source:** [x](https://app.notion.com/p/Fix-deadbeefdeadbeefdeadbeefdeadbeef-in-the-parser-${PAGE_ID})`;
    expect(idFor(body).out).toBe(PAGE_ID);
  });

  it("exits non-zero for an issue filed on GitHub with no roadmap row", () => {
    // The normal case for a bug filed directly. Must not invent an id — writing
    // a status to the wrong Notion page is worse than writing none.
    const { status, out } = idFor("**Module:** ui\n\nSomething is broken.\n");

    expect(status).not.toBe(0);
    expect(out).toBe("");
  });

  it("ignores a non-Notion link that happens to carry 32 hex characters", () => {
    const body = `See [the commit](https://github.com/o/r/commit/${PAGE_ID}) for context.`;
    expect(idFor(body).status).not.toBe(0);
  });
});

describe("every write-back resolves the page id the same way", () => {
  const workflows = [
    ".github/workflows/factory-ship.yml",
    ".github/workflows/factory-deploy.yml",
    ".github/workflows/factory-notion-status.yml",
  ];

  it.each(workflows)("%s calls the script rather than grepping for the marker", (path) => {
    const yaml = readFileSync(path, "utf8");

    expect(yaml).toContain("scripts/factory/notion-page-id.sh");
    // The bare marker grep is what missed the Source link. If it comes back,
    // this fails rather than the next four items shipping with a stale row.
    expect(yaml).not.toMatch(/grep -oE 'notion-page-id: /);
  });

  it.each(workflows)("%s checks out the repo so the script exists", (path) => {
    expect(readFileSync(path, "utf8")).toContain("actions/checkout@v4");
  });
});
