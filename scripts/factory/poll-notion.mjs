#!/usr/bin/env node
/**
 * Polls the Notion roadmap for items marked "Ready for factory",
 * creates a GitHub issue for each, and writes the issue URL back to Notion.
 * An item queued with an empty page body has no spec to build, so it is parked
 * in "Needs spec" instead — it does not consume a slot in the run's cap.
 *
 * Env: NOTION_API_KEY, NOTION_DATABASE_ID, GH_TOKEN, GITHUB_REPOSITORY
 *
 * IMPORTANT: labels are applied in two steps. GitHub emits a separate
 * `labeled` event for every label, so creating an issue with both
 * ["factory", "needs-spec"] fires every downstream workflow twice, and they
 * then cancel one another via the shared concurrency group. Creating with
 * "factory" alone (which matches no workflow condition) and adding
 * "needs-spec" afterwards produces exactly one meaningful trigger.
 */

const NOTION_KEY = process.env.NOTION_API_KEY;
const DB_ID = process.env.NOTION_DATABASE_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;

// Safety valve: never start more than this many items per poll.
const MAX_PER_RUN = Number(process.env.FACTORY_MAX_PER_RUN || 1);

// Where an item is parked when it is queued with no spec written. This option
// must exist on the Status select in Notion or the write back fails.
const NEEDS_SPEC_STATUS = "Needs spec";

const notion = (path, options = {}) =>
  fetch(`https://api.notion.com/v1/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${NOTION_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
  }).then(async (r) => {
    if (!r.ok) throw new Error(`Notion ${path}: ${r.status} ${await r.text()}`);
    return r.json();
  });

const github = (path, options = {}) =>
  fetch(`https://api.github.com/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
  }).then(async (r) => {
    if (!r.ok) throw new Error(`GitHub ${path}: ${r.status} ${await r.text()}`);
    return r.json();
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Flatten a Notion page's blocks into markdown-ish plain text.
async function pageText(pageId) {
  const { results } = await notion(`blocks/${pageId}/children?page_size=100`);
  return results
    .map((b) => {
      const rich = b[b.type]?.rich_text;
      if (!rich) return "";
      const text = rich.map((t) => t.plain_text).join("");
      if (b.type === "heading_1") return `\n# ${text}`;
      if (b.type === "heading_2") return `\n## ${text}`;
      if (b.type === "heading_3") return `\n### ${text}`;
      if (b.type === "bulleted_list_item") return `- ${text}`;
      if (b.type === "numbered_list_item") return `1. ${text}`;
      if (b.type === "to_do") return `- [${b.to_do.checked ? "x" : " "}] ${text}`;
      if (b.type === "code") return "```\n" + text + "\n```";
      return text;
    })
    .filter(Boolean)
    .join("\n");
}

async function main() {
  const { results } = await notion(`databases/${DB_ID}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: { property: "Status", select: { equals: "Ready for factory" } },
      sorts: [
        { property: "Priority", direction: "ascending" },
        { timestamp: "created_time", direction: "ascending" },
      ],
    }),
  });

  if (!results.length) {
    console.log("No items ready for the factory.");
    return;
  }

  console.log(
    `Found ${results.length} ready item(s). Starting up to ${MAX_PER_RUN} ` +
      `(FACTORY_MAX_PER_RUN=${MAX_PER_RUN}).`
  );

  // The cap counts items actually started, not items examined. A skipped item
  // (empty page body) must not consume a batch slot, or one unspecified item
  // stalls the queue for a whole poll interval.
  let started = 0;

  for (const page of results) {
    if (started >= MAX_PER_RUN) break;

    const title =
      page.properties.Name?.title?.map((t) => t.plain_text).join("") ||
      "Untitled roadmap item";
    const moduleName = page.properties.Module?.select?.name || "unassigned";
    const spec = await pageText(page.id);

    if (!spec.trim()) {
      console.log(`Skipping "${title}" - the Notion page body is empty.`);

      // Park it out of the ready filter, so the person who queued it sees the
      // item sitting in "Needs spec" on the board rather than only in a
      // workflow log nobody reads. Best effort: a failure here must not stop
      // the items that *can* start, so log loudly and carry on.
      try {
        await notion(`pages/${page.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            properties: { Status: { select: { name: NEEDS_SPEC_STATUS } } },
          }),
        });
        console.log(`Parked "${title}" as "${NEEDS_SPEC_STATUS}".`);
      } catch (err) {
        console.error(
          `Could not park "${title}" as "${NEEDS_SPEC_STATUS}" - it stays in ` +
            `the ready queue and will be skipped again next poll. ${err.message}`
        );
      }

      continue;
    }

    const body = [
      `**Source:** [Notion roadmap item](${page.url})`,
      `**Module:** ${moduleName}`,
      "",
      "---",
      "",
      spec,
      "",
      "---",
      "",
      `<!-- notion-page-id: ${page.id} -->`,
    ].join("\n");

    // Step 1: create with "factory" only. No workflow reacts to this label.
    const issue = await github(`repos/${REPO}/issues`, {
      method: "POST",
      body: JSON.stringify({ title, body, labels: ["factory"] }),
    });

    console.log(`Created issue #${issue.number}: ${title}`);

    // Step 2: write back to Notion before starting the pipeline, so a failure
    // here cannot leave an item running with no record on the Notion side.
    await notion(`pages/${page.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          Status: { select: { name: "In factory" } },
          "GitHub Issue": { url: issue.html_url },
        },
      }),
    });

    // Step 3: the single label write that actually starts the pipeline.
    await sleep(2000);
    await github(`repos/${REPO}/issues/${issue.number}/labels`, {
      method: "POST",
      body: JSON.stringify({ labels: ["needs-spec"] }),
    });

    started += 1;
    console.log(`Started pipeline for #${issue.number}`);
  }

  if (!started) {
    console.log("Nothing started - every ready item had an empty page body.");
  }
}

export { main };

// Only run if executed directly (not imported for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
