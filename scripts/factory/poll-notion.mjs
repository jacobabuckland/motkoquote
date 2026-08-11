#!/usr/bin/env node
/**
 * Polls one or more Notion databases for items marked "Ready for factory",
 * creates a GitHub issue for each, and writes the issue URL back to Notion.
 * An item queued with an empty page body has no spec to build, so it is parked
 * in "Needs spec" instead — it does not consume a slot in the run's cap.
 *
 * Env: NOTION_API_KEY, NOTION_DATABASE_ID, GH_TOKEN, GITHUB_REPOSITORY
 *
 * NOTION_DATABASE_ID is a comma-separated list, each entry either a bare
 * database id or `id:label`:
 *
 *     3b71…a683:enhancement,3b91…63b3:bug
 *
 * The label is applied to every issue that database produces, so the source is
 * legible on the GitHub side. The mapping lives in the config rather than being
 * inferred from list position or from the database's title, so reordering the
 * list or renaming the database in Notion cannot silently relabel work.
 *
 * The per-run cap is GLOBAL across every database, not per database: two
 * sources must not mean two items start per poll.
 *
 * IMPORTANT: labels are applied in two steps. GitHub emits a separate
 * `labeled` event for every label, so creating an issue with both
 * ["factory", "needs-spec"] fires every downstream workflow twice, and they
 * then cancel one another via the shared concurrency group. Creating with
 * "factory" alone (which matches no workflow condition) and adding
 * "needs-spec" afterwards produces exactly one meaningful trigger. The source
 * label goes in the CREATE call alongside "factory" for the same reason — it
 * matches no workflow condition either, so the count of meaningful triggers is
 * still exactly one, and "needs-spec" remains the sole separate write.
 */

import { pathToFileURL } from "node:url";

const NOTION_KEY = process.env.NOTION_API_KEY;
const DB_ID = process.env.NOTION_DATABASE_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY;

// Safety valve: never start more than this many items per poll.
const MAX_PER_RUN = Number(process.env.FACTORY_MAX_PER_RUN || 1);

// Where an item is parked when it is queued with no spec written. This option
// must exist on the Status select in Notion or the write back fails.
const NEEDS_SPEC_STATUS = "Needs spec";

// Every property the pipeline reads or writes, and the type it must have. A
// database that is missing one of these cannot complete a run, so it is
// rejected before any issue is created rather than failing part-way through
// with a GitHub issue already open and no way to record it in Notion.
const REQUIRED_PROPERTIES = {
  Name: "title",
  Status: "select",
  Module: "select",
  "GitHub Issue": "url",
  "Preview URL": "url",
};

// Every Status option the pipeline writes. "Ready for factory" and "In factory"
// and "Needs spec" are this script's; "Previewed" and "Shipped" belong to
// factory-deploy.yml and factory-ship.yml. They are checked here because this
// is the only place that reads the database list, and admitting an item from a
// database that cannot record its own outcome strands it mid-pipeline.
const REQUIRED_STATUS_OPTIONS = [
  "Ready for factory",
  "In factory",
  NEEDS_SPEC_STATUS,
  "Previewed",
  "Shipped",
];

const NOTION_ID = /^[0-9a-f]{32}$/i;
const NOTION_ID_DASHED =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notion = (path, options = {}) =>
  fetch(`https://api.notion.com/v1/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${NOTION_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
  }).then(async (r) => {
    if (!r.ok) {
      // The status is carried on the error, not just described in its message,
      // so a caller can tell "not shared with the integration" (404) apart from
      // "Notion is down" (5xx) without parsing prose.
      const err = new Error(`Notion ${path}: ${r.status} ${await r.text()}`);
      err.status = r.status;
      throw err;
    }
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

/**
 * Parse NOTION_DATABASE_ID into `{ id, label }` entries.
 *
 * Throws rather than dropping a malformed entry: a typo in the secret must stop
 * the run and say so, not silently poll a shorter list than the operator
 * configured. A database polled twice would create two issues for one page, so
 * a repeated id is an error too, not a de-duplication.
 */
export function parseDatabases(raw) {
  const entries = String(raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!entries.length) {
    throw new Error(
      "NOTION_DATABASE_ID is empty. Expected one or more comma-separated " +
        "database ids, each optionally suffixed with `:label`."
    );
  }

  const databases = [];
  const seen = new Map();

  for (const entry of entries) {
    const [rawId, ...rest] = entry.split(":");
    const id = rawId.trim();
    const label = rest.join(":").trim();

    if (!NOTION_ID.test(id) && !NOTION_ID_DASHED.test(id)) {
      throw new Error(
        `NOTION_DATABASE_ID entry "${entry}" is not a Notion database id. ` +
          "Expected 32 hex characters (dashed or undashed), optionally " +
          "followed by `:label`."
      );
    }

    if (rest.length && !label) {
      throw new Error(
        `NOTION_DATABASE_ID entry "${entry}" has a trailing ":" with no label.`
      );
    }

    // Compared undashed, so the same database written both ways is still one
    // database rather than two that happen to look different.
    const key = id.replace(/-/g, "").toLowerCase();
    if (seen.has(key)) {
      throw new Error(
        `NOTION_DATABASE_ID lists database ${id} more than once. Polling one ` +
          "database twice would open two issues for every ready item."
      );
    }
    seen.set(key, entry);

    databases.push({ id, label: label || null });
  }

  return databases;
}

/**
 * Compare a Notion database's schema against what the pipeline needs, and
 * return a list of human-readable problems (empty when it is usable).
 *
 * Names are matched exactly, and near-misses are called out by name, because
 * Notion property names are case-sensitive: a database with "Github Issue" or
 * "module" looks right to a human reading the board and fails the write-back
 * with a 400 after the GitHub issue has already been created.
 */
export function schemaProblems(database) {
  const problems = [];
  const properties = database?.properties ?? {};
  const names = Object.keys(properties);

  for (const [name, type] of Object.entries(REQUIRED_PROPERTIES)) {
    const property = properties[name];

    if (!property) {
      const nearMiss = names.find(
        (candidate) => candidate.toLowerCase() === name.toLowerCase()
      );
      problems.push(
        nearMiss
          ? `property "${nearMiss}" must be named exactly "${name}" ` +
              "(Notion property names are case-sensitive)"
          : `missing the "${name}" property (expected type ${type})`
      );
      continue;
    }

    if (property.type !== type) {
      problems.push(
        `property "${name}" is a ${property.type}, but the pipeline needs a ${type}`
      );
    }
  }

  if (properties.Status?.type === "select") {
    const options = (properties.Status.select?.options ?? []).map((o) => o.name);
    const missing = REQUIRED_STATUS_OPTIONS.filter((o) => !options.includes(o));
    if (missing.length) {
      problems.push(
        `the Status select is missing the option(s) ${missing
          .map((o) => `"${o}"`)
          .join(", ")} — the pipeline writes every one of them`
      );
    }
  }

  return problems;
}

const databaseTitle = (database) =>
  database?.title?.map((t) => t.plain_text).join("").trim() || "untitled";

/**
 * Fetch a database and confirm the pipeline can actually drive it. Returns the
 * database's title for use in logs; throws with an actionable message if not.
 */
async function verifyDatabase({ id }) {
  let database;
  try {
    database = await notion(`databases/${id}`);
  } catch (err) {
    if (err.status === 404) {
      throw new Error(
        `database ${id} is not visible to the integration. Either the id is ` +
          "wrong, or the database has not been shared with the Notion " +
          "integration that owns NOTION_API_KEY (open it in Notion → ••• → " +
          "Connections → add the integration)."
      );
    }
    throw err;
  }

  const problems = schemaProblems(database);
  if (problems.length) {
    throw new Error(
      `database "${databaseTitle(database)}" (${id}) does not match the ` +
        `schema the factory drives:\n${problems
          .map((p) => `  - ${p}`)
          .join("\n")}`
    );
  }

  return databaseTitle(database);
}

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
  const databases = parseDatabases(DB_ID);

  // One unusable database must not take the others down with it: a bugs
  // database that nobody remembered to share cannot be allowed to stop feature
  // work. Failures are collected, announced as workflow errors, and turned into
  // a non-zero exit at the very end — so the run goes red and is noticed, but
  // only after every healthy queue has been served.
  const failures = [];

  const sources = [];
  for (const database of databases) {
    try {
      const name = await verifyDatabase(database);
      sources.push({ ...database, name });
    } catch (err) {
      failures.push(err);
      console.error(`::error::Skipping a database — ${err.message}`);
    }
  }

  if (!sources.length) {
    throw new Error("No usable Notion database. Nothing was polled.");
  }

  const ready = [];
  for (const source of sources) {
    try {
      const { results } = await notion(`databases/${source.id}/query`, {
        method: "POST",
        body: JSON.stringify({
          filter: {
            property: "Status",
            select: { equals: "Ready for factory" },
          },
        }),
      });
      console.log(`${source.name}: ${results.length} ready item(s).`);
      // Each page is carried with the database it came from, because the label
      // to apply and the name to log both belong to the source, and once the
      // lists are combined the page itself no longer says where it came from.
      for (const page of results) ready.push({ page, source });
    } catch (err) {
      failures.push(err);
      console.error(
        `::error::Could not query "${source.name}" (${source.id}) — its ready ` +
          `items are not considered this run. ${err.message}`
      );
    }
  }

  if (!ready.length) {
    console.log("No items ready for the factory.");
    return failures;
  }

  console.log(
    `Found ${ready.length} ready item(s) across ${sources.length} database(s). ` +
      `Starting up to ${MAX_PER_RUN} (FACTORY_MAX_PER_RUN=${MAX_PER_RUN}).`
  );

  // The cap counts items actually started, not items examined. A skipped item
  // (empty page body) must not consume a batch slot, or one unspecified item
  // stalls the queue for a whole poll interval. It is deliberately counted
  // across every database rather than per database: two sources must not mean
  // two items start per poll.
  let started = 0;

  for (const { page, source } of ready) {
    if (started >= MAX_PER_RUN) break;

    const title =
      page.properties.Name?.title?.map((t) => t.plain_text).join("") ||
      `Untitled ${source.name} item`;
    const moduleName = page.properties.Module?.select?.name || "unassigned";
    const spec = await pageText(page.id);

    if (!spec.trim()) {
      console.log(
        `Skipping "${title}" (${source.name}) - the Notion page body is empty.`
      );

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
      `**Source:** [${source.name}](${page.url})`,
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

    // Step 1: create with "factory" and the source label. No workflow reacts to
    // either, so this is still zero meaningful triggers — the invariant is one
    // trigger in total, not one label in total, and "needs-spec" below is it.
    const labels = ["factory", ...(source.label ? [source.label] : [])];
    const issue = await github(`repos/${REPO}/issues`, {
      method: "POST",
      body: JSON.stringify({ title, body, labels }),
    });

    console.log(
      `Created issue #${issue.number} from ${source.name}: ${title} ` +
        `[${labels.join(", ")}]`
    );

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

  return failures;
}

// Only polls when run as a script. `parseDatabases` and `schemaProblems` are
// exported for tests, and importing them must never open a GitHub issue.
const runAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runAsScript) {
  main()
    .then((failures = []) => {
      // Reported only now, after the healthy databases have been served, so a
      // broken second source is loud without being able to block the first.
      if (failures.length) {
        console.error(
          `${failures.length} database(s) failed this run. See the errors above.`
        );
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
