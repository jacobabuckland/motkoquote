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

import { admissionBlocker, parseProgrammeItem } from "./admission-order.mjs";
import {
  admissionVerdict,
  detectHumanGates,
  renderGateNotice,
} from "./admission-gates.mjs";

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
//
// PAGINATED. This read one page of 100 blocks and stopped, silently: a spec
// longer than that arrived at the PM with its tail missing and no indication
// anything had been dropped — and the tail is where a card keeps its edge cases
// and derived criteria. A truncated spec is worse than an empty one, because an
// empty body is parked in "Needs spec" and a truncated body looks complete.
//
// The extra request only happens when Notion says there is more, so a card that
// fitted in one page still costs exactly one call.
async function pageText(pageId) {
  const results = [];
  let cursor = null;
  do {
    const query = cursor
      ? `blocks/${pageId}/children?page_size=100&start_cursor=${cursor}`
      : `blocks/${pageId}/children?page_size=100`;
    const page = await notion(query);
    results.push(...(page.results ?? []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);

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

  // Every factory issue, open AND closed, for the ordering gate below. Closed
  // matters: a shipped predecessor is closed, and reading "absent from the open
  // list" as "not started" would deadlock a programme after its first item
  // ships.
  //
  // Fetched LAZILY, on the first candidate that belongs to a sequenced
  // programme, and never otherwise. Not an optimisation: an unconditional call
  // here adds a request to every poll, and #115's acceptance test drives this
  // script through a mocked fetch whose call sequence is part of the frozen
  // contract. A gate for LED must not change what a poll does when no LED item
  // is on the board.
  //
  // Best effort — if it cannot be read, the gate opens rather than stopping the
  // queue, and says so. One poll without ordering enforced beats a queue halted
  // by a transient API error.
  let knownItems = null;
  const loadKnownItems = async () => {
    if (knownItems !== null) return knownItems;
    try {
      const issues = await github(
        `repos/${REPO}/issues?labels=factory&state=all&per_page=100`
      );
      knownItems = (issues || []).map((i) => ({
        number: i.number,
        title: i.title,
        state: i.state,
        labels: (i.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
      }));
    } catch (err) {
      console.error(
        `::warning::Could not read existing factory issues, so admission ordering ` +
          `is not enforced this poll: ${err.message}`
      );
      knownItems = [];
    }
    return knownItems;
  };

  for (const page of results) {
    if (started >= MAX_PER_RUN) break;

    const title =
      page.properties.Name?.title?.map((t) => t.plain_text).join("") ||
      "Untitled roadmap item";
    // Ordering gate. A stacked programme's later item specced against a `main`
    // that lacks its predecessor's schema produces a duplicate table and a
    // colliding migration — LED-1 and LED-2 did exactly that. Held items keep
    // their "Ready for factory" status in Notion and are reconsidered next
    // poll, and do NOT consume a cap slot: holding one must not cost the queue
    // a turn.
    // Cheap check first: parse the title, and only reach for the issue list if
    // this item is actually part of a sequenced programme.
    const held = parseProgrammeItem(title)
      ? admissionBlocker(title, await loadKnownItems())
      : null;
    if (held) {
      console.log(`Holding "${title}" — ${held.reason}.`);
      continue;
    }

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

    // A card can state a gate no stage in the pipeline can satisfy — "do not
    // queue to the factory", or a legal sign-off before merge. Three such cards
    // were queued and built before this existed, and LED-4's VAT wording only
    // reached a human because the PM happened to copy the gate into the spec.
    //
    // The item is still CREATED. An item that is never created is invisible,
    // and invisible is how PAY-7 stayed queued for a day. It simply never gets
    // a stage label, so no agent runs on it.
    const gates = detectHumanGates(spec);
    const verdict = admissionVerdict(gates);

    if (verdict.stopped) {
      console.log(`Stopping #${issue.number} at admission — ${verdict.reason}.`);

      await github(`repos/${REPO}/issues/${issue.number}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: renderGateNotice(gates, verdict.reason) }),
      });

      // `blocked`, not a stage label. This is the one stopped state the
      // decisions digest already reports and the block ledger already records,
      // so a gated item is surfaced by machinery that exists rather than by a
      // new lane nobody reads.
      //
      // `awaiting-dependency` alongside it, because those two facts are not the
      // same fact. `blocked` is what the digest and the ledger read. The second
      // label says WHY, and the poller's admission ceiling subtracts it.
      //
      // Without that subtraction this gate deadlocks against itself. FEE-8 was
      // held on 30 Aug for "Depends on FEE-6 and FEE-7" — correctly — and its
      // `blocked` label took the stopped count to the ceiling of 5, at which
      // the poller admits nothing. So the one item that could release FEE-8
      // could not be admitted, because FEE-8 was holding the door shut against
      // it. Nothing was wrong with either gate alone.
      //
      // The ceiling is a budget for HUMAN ATTENTION — its own comment says
      // every stopped item "waits on the same single human". This one does not.
      // It waits on a ticket, and AGENTS.md is explicit that a dependency is
      // "not a decision" and the item should be returned to the queue with a
      // wake condition. Spending a human-attention slot on something no human
      // is being asked about is what produced the deadlock.
      await github(`repos/${REPO}/issues/${issue.number}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels: ["blocked", "awaiting-dependency"] }),
      });

      // "Blocked", not "In factory". Writing "In factory" for an item no agent
      // will touch is the same lie the Notion write-back was built to stop.
      await notion(`pages/${page.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          properties: {
            Status: { select: { name: "Blocked" } },
            "GitHub Issue": { url: issue.html_url },
          },
        }),
      });

      // No stage label, and no slot consumed: holding one item must not cost
      // the queue a turn, exactly as with the ordering gate above.
      continue;
    }

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
