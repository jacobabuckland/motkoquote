#!/usr/bin/env node
/**
 * Polls the Notion roadmap for items marked "Ready for factory",
 * creates a GitHub issue for each, and writes the issue URL back to Notion.
 *
 * Env: NOTION_API_KEY, NOTION_DATABASE_ID, GH_TOKEN, GITHUB_REPOSITORY
 */

const NOTION_KEY = process.env.NOTION_API_KEY;
const DB_ID = process.env.NOTION_DATABASE_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;

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
    }),
  });

  if (!results.length) {
    console.log("No items ready for the factory.");
    return;
  }

  console.log(`Found ${results.length} ready item(s).`);

  for (const page of results) {
    const title =
      page.properties.Name?.title?.map((t) => t.plain_text).join("") ||
      "Untitled roadmap item";
    const module = page.properties.Module?.select?.name || "unassigned";
    const spec = await pageText(page.id);

    const body = [
      `**Source:** [Notion roadmap item](${page.url})`,
      `**Module:** ${module}`,
      "",
      "---",
      "",
      spec || "_No spec content found in the Notion page body._",
      "",
      "---",
      "",
      `<!-- notion-page-id: ${page.id} -->`,
    ].join("\n");

    const issue = await github(`repos/${REPO}/issues`, {
      method: "POST",
      body: JSON.stringify({ title, body, labels: ["factory", "needs-spec"] }),
    });

    console.log(`Created issue #${issue.number}: ${title}`);

    await notion(`pages/${page.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        properties: {
          Status: { select: { name: "In factory" } },
          "GitHub Issue": { url: issue.html_url },
        },
      }),
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
