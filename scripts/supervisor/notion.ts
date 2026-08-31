/**
 * Notion REST client for the supervisor.
 *
 * Deliberately not the MCP server: this runs in Actions, where there is an API
 * key and no MCP. It mirrors `scripts/factory/poll-notion.mjs` — same version
 * pin, same auth header — so the two clients cannot disagree about what the
 * board says.
 *
 * Every list read is paginated to exhaustion. `poll-notion.mjs` shipped a
 * single-page read of a paginated endpoint and truncated long specs silently;
 * the same mistake here would truncate the BOARD, and a board read that stops
 * at 100 rows diffs as "everything after row 100 was deleted".
 */

import { NOTION_VERSION } from "./config";

const KEY = process.env.NOTION_API_KEY ?? "";

export class NotionRateLimited extends Error {}

export interface NotionPage {
  id: string;
  properties: Record<string, unknown>;
  created_time?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One request, with backoff on 429 and 5xx.
 *
 * Gives up after four attempts and throws `NotionRateLimited`. The caller's
 * only correct response to that is to abandon the run — a hard constraint says
 * "back off and skip the run rather than partial-snapshot", because a partial
 * snapshot diffs as mass change and would emit a digest claiming half the
 * board moved.
 */
export async function notion<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!KEY) {
    throw new Error(
      "CAPABILITY FAULT: NOTION_API_KEY is not set. The supervisor cannot read the board.",
    );
  }

  let wait = 1000;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`https://api.notion.com/v1/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (res.ok) return (await res.json()) as T;

    if (res.status === 429 || res.status >= 500) {
      if (attempt === 4) {
        throw new NotionRateLimited(
          `Notion ${path}: ${res.status} after ${attempt} attempts — skipping this run rather than taking a partial snapshot.`,
        );
      }
      // Honour Retry-After when Notion sends one; it knows better than the
      // doubling does.
      const retryAfter = Number(res.headers.get("retry-after") ?? 0);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : wait);
      wait *= 2;
      continue;
    }

    throw new Error(`Notion ${path}: ${res.status} ${await res.text()}`);
  }

  throw new NotionRateLimited(`Notion ${path}: exhausted retries`);
}

/** Every page in a database, following `next_cursor` to the end. */
export async function queryDatabase(dbId: string): Promise<NotionPage[]> {
  const out: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const page = await notion<{
      results: NotionPage[];
      has_more: boolean;
      next_cursor: string | null;
    }>(`databases/${dbId}/query`, { method: "POST", body: JSON.stringify(body) });

    out.push(...(page.results ?? []));
    cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;

    // Notion's published limit is ~3 requests/second averaged. One board is a
    // handful of pages, so a flat pause between them costs nothing and keeps
    // the supervisor from contending with the poller on the same minute.
    if (cursor) await sleep(350);
  } while (cursor);

  return out;
}

/* -------------------------------------------------------------------------- */
/* Property readers.                                                          */
/*                                                                            */
/* Each one returns a value for a MISSING or MALFORMED property rather than    */
/* throwing. The August blank row took a poller down; a hard constraint says   */
/* null titles and unknown values are counted and reported, never thrown on,   */
/* and that is only true if the readers themselves never throw.                */
/* -------------------------------------------------------------------------- */

interface RichText {
  plain_text?: string;
}

export function readTitle(page: NotionPage): string | null {
  const prop = page.properties?.Name as { title?: RichText[] } | undefined;
  const text = (prop?.title ?? [])
    .map((t) => t.plain_text ?? "")
    .join("")
    .trim();
  return text.length > 0 ? text : null;
}

export function readSelect(page: NotionPage, name: string): string | null {
  // Notion has two single-choice property types and the board uses both:
  // `Status` was a `select` when the poller was written and a `status` type
  // when the deploy stage started writing it (see factory-deploy.yml's comment
  // about "a `status` type"). Reading only one of them returns null for half
  // the board, which diffs as every ticket losing its status at once.
  const prop = page.properties?.[name] as
    | { select?: { name?: string } | null; status?: { name?: string } | null }
    | undefined;
  return prop?.select?.name ?? prop?.status?.name ?? null;
}

export function readUrl(page: NotionPage, name: string): string | null {
  const prop = page.properties?.[name] as { url?: string | null } | undefined;
  const url = prop?.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}
