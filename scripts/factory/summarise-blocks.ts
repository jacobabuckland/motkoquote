/**
 * Render the weekly block summary for the decisions digest.
 *
 *   npx tsx scripts/factory/summarise-blocks.ts [--days 7]
 *
 * Reads the ledger off the tracker issue and prints one section. Kept separate
 * from the recorder so the digest never needs write access to record anything.
 */

import { parseRecords, renderWeeklyLine, summarise } from "./block-ledger";

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const REPO = process.env.GH_REPO ?? "jacobabuckland/motkoquote";
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "";
const TRACKER = process.env.TRACKER ?? "157";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

async function main(): Promise<void> {
  const days = arg("days", 7);
  const bodies: string[] = [];

  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${API}/repos/${REPO}/issues/${TRACKER}/comments?per_page=100&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${TOKEN}`,
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    if (!res.ok) throw new Error(`reading the ledger failed: ${res.status}`);
    const batch = (await res.json()) as { body: string }[];
    if (batch.length === 0) break;
    bodies.push(...batch.map((c) => c.body));
    if (batch.length < 100) break;
  }

  console.log(renderWeeklyLine(summarise(parseRecords(bodies), new Date().toISOString(), days), days));
}

if (process.argv[1]?.endsWith("summarise-blocks.ts")) {
  main().catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
}
